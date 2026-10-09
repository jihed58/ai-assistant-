const { Mistral } = require('@mistralai/mistralai');

// Lazy-initialize the Mistral client (ensures .env is loaded first)
let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY is not set in .env');
    }
    client = new Mistral({ apiKey });
  }
  return client;
}

// System Prompt for query generation with conversational fallback
const SYSTEM_PROMPT = `Tu es un assistant IA expert en bases de données MongoDB pour un système ERP d'entreprise.
Ton rôle est d'analyser la question de l'utilisateur et de déterminer comment y répondre.

Voici les collections existantes dans la base de données ERP :
- "employe" : employés, personnel, salariés (champs: idEmploye, nom, prenom, matricule, etat)
- "departement" : départements, services, pôles (champs: idDepartement, departement, code, etat)
- "client" : clients de l'entreprise (champs: idClient, client, nomClient, etat)
- "article" : articles, produits, pièces, inventaire, stock (champs: idArticle, article, code)
- "fournisseur" : fournisseurs, prestataires (champs: idFournisseur, fournisseur)
- "facture" : factures émises ou reçues (champs: idFacture, libFacture, etat)
- "parcmachine" : machines, parc de machines, équipements techniques (champs: idMachine, machine, numero, etat)
- "intervention" : interventions de maintenance, pannes, réparations (champs: idIntervention, numero, descriptionIntervention)

RÈGLES STRICTES DE RÉPONSE EN JSON UNIQUEMENT :
1. Si la question concerne l'une de ces collections ERP, renvoie UNIQUEMENT :
   {
     "type": "query",
     "collection": "nom_de_la_collection",
     "query": { "champ": "valeur" },
     "limit": 50
   }

2. Si l'utilisateur salue poliment (ex: "bonjour", "salut", "qui es-tu ?"), renvoie :
   {
     "type": "direct_reply",
     "message": "Bonjour ! Je suis votre assistant ERP. Vous pouvez me poser des questions sur les employés, les clients, les stocks d'articles, les factures, les fournisseurs ou les machines."
   }

3. Si la question est hors sujet (ex: météo, blagues, sports, actualités), renvoie :
   {
     "type": "direct_reply",
     "message": "Je suis conçu uniquement pour vous renseigner sur les données de votre entreprise (employés, clients, stocks, factures, machines, etc.). Je ne peux pas répondre à des questions extérieures à l'ERP."
   }

4. Si la question est incompréhensible ou trop vague, renvoie :
   {
     "type": "direct_reply",
     "message": "Je n'ai pas bien compris votre question. Pourriez-vous préciser ce que vous cherchez ? Par exemple : 'Combien d\\'articles avons-nous en stock ?' ou 'Donne-moi la liste des clients'."
   }

5. Pour les recherches textuelles, utilise l'opérateur MongoDB $regex avec { "$options": "i" }.
6. Pour le champ 'etat' : 1 = actif, 0 = inactif.
7. Ne génère JAMAIS de requêtes de modification ou suppression.`;

/**
 * Extracts a human-readable title/name from any ERP document.
 */
function extractDisplayName(doc, collection) {
  if (!doc) return 'Élément';
  if (collection === 'employe') {
    const full = `${doc.prenom || ''} ${doc.nom || ''}`.trim();
    return full || `Employé #${doc.idEmploye || doc.matricule || 'inconnu'}`;
  }
  if (collection === 'client') return doc.client || doc.nomClient || `Client #${doc.idClient || 'inconnu'}`;
  if (collection === 'article') return doc.article || doc.code || `Article #${doc.idArticle || 'inconnu'}`;
  if (collection === 'departement') return doc.departement || doc.code || `Département #${doc.idDepartement || 'inconnu'}`;
  if (collection === 'fournisseur') return doc.fournisseur || `Fournisseur #${doc.idFournisseur || 'inconnu'}`;
  if (collection === 'parcmachine') return doc.machine || doc.numero || `Machine #${doc.idMachine || 'inconnu'}`;
  if (collection === 'facture') return doc.libFacture || `Facture #${doc.idFacture || 'inconnu'}`;
  if (collection === 'intervention') return doc.descriptionIntervention || doc.numero || `Intervention #${doc.idIntervention || 'inconnu'}`;
  return doc.nom || doc.libelle || doc.titre || doc.code || Object.values(doc).find(v => typeof v === 'string') || 'Élément';
}

const generateMongoQuery = async (userPrompt) => {
  try {
    console.log(`[MistralService] Processing prompt: "${userPrompt}"`);

    const chatResponse = await getClient().chat.complete({
      model: 'ministral-3b-latest',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      responseFormat: { type: 'json_object' }
    });

    const responseText = chatResponse.choices[0].message.content;
    const queryObject = JSON.parse(responseText);
    return queryObject;
  } catch (error) {
    console.error('[MistralService] Error in generateMongoQuery:', error.message || error);
    throw error;
  }
};

/**
 * Generates natural text answer with strict distinction between count and list.
 */
const generateNaturalAnswer = async (userPrompt, results, collectionName) => {
  try {
    console.log(`[MistralService] Formulating natural answer for: "${userPrompt}" (${results.length} docs retrieved)`);

    const sampleNames = results.slice(0, 30).map(doc => extractDisplayName(doc, collectionName)).filter(Boolean);

    const promptForAnswer = `Tu es un assistant ERP intelligent, précis et courtois.
Question de l'utilisateur : "${userPrompt}"
Collection de la base de données : ${collectionName}
Total d'enregistrements trouvés : ${results.length}
${sampleNames.length > 0 ? `Noms des éléments trouvés :\n${sampleNames.map(n => '- ' + n).join('\n')}` : 'Aucun élément trouvé.'}

CONSIGNES STRICTES :
1. COMPTAGE / NOMBRE : Si l'utilisateur demande "combien", "quel est le nombre", "nombre de" ou "how many", réponds UNIQUEMENT avec le nombre total en une phrase claire (ex: "Il y a ${results.length} ${collectionName}s enregistrés."). Ne donne PAS de liste.
2. LISTE D'ÉLÉMENTS : Si l'utilisateur demande une liste ("donne-moi la liste", "affiche les", "quels sont", "liste de", "show me", "give me"), énumère clairement les éléments sous forme de liste à puces avec leurs vrais noms, puis indique le total.
3. AUCUN RÉSULTAT : Si aucun enregistrement n'a été trouvé, explique poliment qu'aucun élément ne correspond.
4. Réponds en français fluide, élégant et direct, sans code, sans JSON ni balises techniques.`;

    const chatResponse = await getClient().chat.complete({
      model: 'ministral-3b-latest',
      messages: [
        { role: 'user', content: promptForAnswer }
      ]
    });

    return chatResponse.choices[0].message.content;
  } catch (error) {
    console.error('[MistralService] Error formulating text reply:', error.message || error);
    if (!results || results.length === 0) {
      return "Aucun enregistrement correspondant n'a été trouvé dans la base de données pour votre recherche.";
    }
    return `J'ai trouvé ${results.length} résultat(s) correspondant à votre demande dans la base de données.`;
  }
};

module.exports = { generateMongoQuery, generateNaturalAnswer };
