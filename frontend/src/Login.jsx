import { useState } from 'react';
import axios from 'axios';

export default function Login({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (email && password) {
      if (isRegistering && !name) return;
      
      setLoading(true);
      try {
        const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
        const payload = isRegistering ? { name, email, password } : { email, password };
        
        const res = await axios.post(endpoint, payload);
        
        // Save token and user
        localStorage.setItem('erp_auth_token', res.data.token);
        localStorage.setItem('erp_user', JSON.stringify(res.data.user));
        
        onLogin(res.data.user);
      } catch (err) {
        console.error("Login/Register Error:", err);
        if (err.response) {
          setError(err.response.data?.message || `Erreur serveur (${err.response.status}).`);
        } else if (err.request) {
          setError("Impossible de joindre le serveur. Vérifiez que le backend est lancé.");
        } else {
          setError(err.message || 'Une erreur est survenue.');
        }
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-logo">
          <h2>Assistant ERP <span>AI</span></h2>
          <p>{isRegistering ? "Créez votre compte pour commencer" : "Connectez-vous pour accéder à l'assistant"}</p>
        </div>
        
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={handleSubmit} className="login-form">
          {isRegistering && (
            <div className="form-group">
              <label>Nom complet</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jean Dupont"
                required={isRegistering} 
                disabled={loading}
              />
            </div>
          )}
          
          <div className="form-group">
            <label>Adresse Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@entreprise.com"
              required 
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <label>Mot de passe</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required 
              disabled={loading}
            />
          </div>
          
          <button type="submit" className="login-button" disabled={loading}>
            {loading ? "Chargement..." : (isRegistering ? "Créer un compte" : "Se connecter")}
          </button>
        </form>
        
        <div className="login-footer">
          <p className="toggle-auth">
            {isRegistering ? "Vous avez déjà un compte ?" : "Pas encore de compte ?"}{" "}
            <span onClick={() => { setIsRegistering(!isRegistering); setError(''); }}>
              {isRegistering ? "Se connecter" : "S'inscrire"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
