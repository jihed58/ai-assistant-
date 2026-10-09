const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

// Dedicated axios instance with 5-minute timeout
const ollamaClient = axios.create({
  baseURL: OLLAMA_URL,
  timeout: 300000,
});

// Friendly French labels for each ERP collection
const COLLECTION_LABELS = {
  employe: { singular: 'employé', plural: 'employés' },
  departement: { singular: 'département', plural: 'départements' },
  client: { singular: 'client', plural: 'clients' },
  article: { singular: 'article en stock', plural: 'articles en stock' },
  fournisseur: { singular: 'fournisseur', plural: 'fournisseurs' },
  facture: { singular: 'facture', plural: 'factures' },
  parcmachine: { singular: 'machine', plural: 'machines' },
  intervention: { singular: 'intervention', plural: 'interventions' },
};

// System Prompt for query generation
const SYSTEM_PROMPT = `Tu es un assistant IA pour une base de données ERP MongoDB.
Collections disponibles :
- "employe" : employés, personnel (idEmploye, nom, prenom, matricule, etat)
- "departement" : départements, services (idDepartement, departement, code, etat)
- "client" : clients (idClient, client, nomClient, etat)
- "article" : stock, articles, produits (idArticle, article, code)
- "fournisseur" : fournisseurs (idFournisseur, fournisseur)
- "facture" : factures (idFacture, libFacture, etat)
- "parcmachine" : machines, parcs (idMachine, machine, numero, etat)
- "intervention" : maintenance (idIntervention, numero, descriptionIntervention)

RÈGLES STRICTES (JSON UNIQUEMENT) :
1. Question sur l'ERP : renvoie UNIQUEMENT {"type":"query","collection":"nom","query":{},"limit":50}
   Pour lister ou compter tous les éléments, utilise toujours "query": {} (objet vide). Ne mets JAMAIS "_id": null.
2. Salutation simple : renvoie {"type":"direct_reply","message":"Bonjour ! Comment puis-je vous aider avec les données de l'ERP ?"}
3. Hors sujet ou météo : renvoie {"type":"direct_reply","message":"Je suis conçu uniquement pour vous renseigner sur les données de l'ERP."}
4. Recherches textuelles : utilise $regex avec $options:"i".
5. 'etat' : 1 = actif, 0 = inactif. Pas d'écriture.`;

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

/**
 * Checks if local Ollama server is running.
 */
const isOllamaRunning = async () => {
  try {
    const res = await ollamaClient.get('/api/tags', { timeout: 2000 });
    return res.status === 200;
  } catch {
    return false;
  }
};

/**
 * Generates MongoDB query using local Ollama.
 */
const generateMongoQuery = async (userPrompt) => {
  try {
    console.log(`[OllamaService] Processing prompt offline: "${userPrompt}"`);

    const res = await ollamaClient.post('/api/chat', {
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      format: 'json',
      options: {
        num_predict: 80,
        temperature: 0.1
      }
    });

    let content = res.data?.message?.content || '{}';
    console.log(`[OllamaService] Raw reply:`, content);

    // Strip markdown code fences if present
    content = content.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Extract first JSON block if surrounded by text
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }

    try {
      return JSON.parse(content);
    } catch (parseErr) {
      console.warn('[OllamaService] Could not parse JSON, falling back to direct reply');
      return {
        type: 'direct_reply',
        message: "Je n'ai pas pu formuler de requête précise pour cette question. Pourriez-vous la reformuler plus simplement ?",
      };
    }
  } catch (error) {
    console.error('[OllamaService] Error generating query:', error.message || error);
    throw error;
  }
};

/**
 * Generates natural text answer with strict differentiation between COUNT and LIST.
 */
const generateNaturalAnswer = async (userPrompt, results, collectionName) => {
  try {
    console.log(`[OllamaService] Formulating answer for: "${userPrompt}" (${results.length} docs in ${collectionName})`);

    const label = COLLECTION_LABELS[collectionName] || { singular: collectionName, plural: `${collectionName}s` };
    const promptLower = (userPrompt || '').toLowerCase();

    // 1️⃣ Strict detection for COUNT ("combien", "nombre", "how many", "total")
    const isCount = /\b(combien|nombre|quantit[eé]|total|compte|how many|count)\b/i.test(promptLower);
    if (isCount) {
      if (results.length === 0) {
        return `Il n'y a actuellement aucun(e) **${label.singular}** enregistré(e) dans la base de données.`;
      }
      return `Il y a actuellement **${results.length} ${label.plural}** enregistré(s) dans le système ERP.`;
    }

    // 2️⃣ Strict detection for LIST ("donne-moi la liste", "liste des", "quels sont", "affiche")
    const isList = /\b(liste|donne|affiche|montre|quels|quelles|voir|qui sont|show|list)\b/i.test(promptLower);
    if (isList) {
      if (results.length === 0) {
        return `Aucun(e) **${label.singular}** n'a été trouvé(e) dans la base de données.`;
      }
      const sampleNames = results.slice(0, 30).map(d => extractDisplayName(d, collectionName)).filter(Boolean);
      let listReply = `Voici la liste des **${label.plural}** enregistrés dans l'ERP (${results.length} au total) :\n\n`;
      listReply += sampleNames.map(n => `• ${n}`).join('\n');
      if (results.length > 30) {
        listReply += `\n\n*(... et ${results.length - 30} autre(s) ${label.plural} dans la base de données)*`;
      }
      return listReply;
    }

    // 3️⃣ For other specific questions, ask Ollama with the clean names
    const sampleNames = results.slice(0, 15).map(doc => extractDisplayName(doc, collectionName)).filter(Boolean);
    const promptForAnswer = `Tu es un assistant ERP. Réponds en français direct et naturel à : "${userPrompt}"
Données ERP (${collectionName}, ${results.length} résultats trouvés) :
${sampleNames.map(n => '- ' + n).join('\n')}

Consigne : Réponds en 1 ou 2 phrases concises et polies, sans code.`;

    const res = await ollamaClient.post('/api/chat', {
      model: OLLAMA_MODEL,
      messages: [
        { role: 'user', content: promptForAnswer }
      ],
      stream: false,
      options: {
        num_predict: 150,
        temperature: 0.1
      }
    });

    return res.data?.message?.content || (results.length > 0 ? `Il y a ${results.length} élément(s) correspondant(s).` : "Aucun élément trouvé.");
  } catch (error) {
    console.error('[OllamaService] Error formulating text answer:', error.message || error);
    if (!results || results.length === 0) {
      return "Aucun enregistrement correspondant n'a été trouvé dans la base de données pour votre recherche.";
    }
    return `J'ai trouvé ${results.length} élément(s) correspondant à votre recherche dans la base de données.`;
  }
};

module.exports = {
  extractDisplayName,
  isOllamaRunning,
  generateMongoQuery,
  generateNaturalAnswer
};
