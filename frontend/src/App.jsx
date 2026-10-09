import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import Login from './Login'

const INITIAL_MESSAGE = {
  type: 'ai',
  text: "Bonjour ! 👋 Je suis votre assistant ERP intelligent.\n\nPosez-moi vos questions en langage naturel et je chercherai directement les réponses dans la base de données pour vous.\n\n💡 Exemples de questions :\n• \"Combien d'articles y a-t-il en stock ?\"\n• \"Donne-moi la liste des employés avec leurs noms et prénoms\"\n• \"Quels sont les clients enregistrés ?\"\n• \"Y a-t-il des machines en panne ?\"",
};

// Helper: get storage key per user
function getSessionsKey() {
  try {
    const user = JSON.parse(localStorage.getItem('erp_user') || '{}');
    return user.id ? `erp_chat_sessions_${user.id}` : 'erp_chat_sessions';
  } catch {
    return 'erp_chat_sessions';
  }
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('erp_auth_token'));
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);

  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState('auto')
  const chatEndRef = useRef(null)

  // Load sessions from localStorage (runs on mount AND when user logs in)
  useEffect(() => {
    if (!isLoggedIn) return;

    const key = getSessionsKey();
    const storedSessions = localStorage.getItem(key);
    if (storedSessions) {
      try {
        const parsed = JSON.parse(storedSessions);
        setSessions(parsed);
        if (parsed.length > 0) {
          setCurrentSessionId(parsed[0].id);
          setMessages(parsed[0].messages);
        } else {
          createNewChat();
        }
      } catch (e) {
        console.error("Erreur lecture sessions", e);
        createNewChat();
      }
    } else {
      createNewChat();
    }
  }, [isLoggedIn]);

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    if (sessions.length > 0 && isLoggedIn) {
      const key = getSessionsKey();
      localStorage.setItem(key, JSON.stringify(sessions));
    }
  }, [sessions]);

  // Update current session's messages in the sessions array
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      setSessions(prev => prev.map(s => {
        if (s.id === currentSessionId) {
          let title = s.title;
          if (title === 'Nouvelle discussion' && messages.length > 1) {
            const firstUserMsg = messages.find(m => m.type === 'user');
            if (firstUserMsg) {
              title = firstUserMsg.text.length > 25 ? firstUserMsg.text.substring(0, 25) + '...' : firstUserMsg.text;
            }
          }
          return { ...s, messages, title };
        }
        return s;
      }));
    }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentSessionId])

  const createNewChat = () => {
    const newSession = {
      id: Date.now().toString(),
      title: 'Nouvelle discussion',
      messages: [INITIAL_MESSAGE],
      date: new Date().toISOString()
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setMessages(newSession.messages);
  };

  const switchSession = (id) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setMessages(session.messages);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { type: 'user', text: userMessage }])
    setLoading(true)

    try {
      const res = await axios.post('/api/query', { prompt: userMessage, provider }, { timeout: 300000 })
      const { reply } = res.data

      setMessages((prev) => [
        ...prev,
        {
          type: 'ai',
          text: reply,
        },
      ])
    } catch (err) {
      const errorMsg =
        err.response?.data?.reply ||
        err.response?.data?.message ||
        "Impossible de joindre le serveur. Assurez-vous que le backend est bien démarré."
      setMessages((prev) => [
        ...prev,
        { type: 'ai', text: errorMsg },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('erp_auth_token');
    localStorage.removeItem('erp_user');
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([INITIAL_MESSAGE]);
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return <Login onLogin={() => setIsLoggedIn(true)} />
  }

  const currentUser = JSON.parse(localStorage.getItem('erp_user') || '{}');

  return (
    <div className="app-layout">
      <div className="sidebar">
        <button className="new-chat-btn" onClick={createNewChat}>
          + Nouvelle discussion
        </button>
        <div className="history-list">
          {sessions.map(s => (
            <div 
              key={s.id} 
              className={`history-item ${s.id === currentSessionId ? 'active' : ''}`}
              onClick={() => switchSession(s.id)}
              title={s.title}
            >
              💬 {s.title}
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="user-info">
            👤 {currentUser.name || 'Utilisateur'}
          </div>
          <button onClick={handleLogout} className="logout-btn">
            Déconnexion
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="app-container">
          <div className="header">
            <div className="header-text">
              <h1>🤖 Assistant ERP Intelligent</h1>
              <p>Interrogez les données de l'ERP en langage naturel direct</p>
            </div>
            <div className="provider-select">
              <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={loading}>
                <option value="auto">Modèle : Auto-détection</option>
                <option value="ollama">Modèle : Ollama (Local)</option>
                <option value="mistral">Modèle : Mistral (Cloud)</option>
              </select>
            </div>
          </div>

          <div className="chat-area">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`message ${msg.type}`}
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {msg.text}
              </div>
            ))}

            {loading && (
              <div className="message ai" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span style={{ fontSize: '13px', color: '#9ca3af' }}>L'assistant local analyse votre question...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <form className="input-area" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question en français... (ex: Combien d'articles avons-nous ?)"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              {loading ? '...' : 'Envoyer'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default App
