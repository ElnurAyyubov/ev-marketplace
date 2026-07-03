import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import { useIdentity } from '../context/IdentityContext';

export function RegisterPage() {
  const { identity } = useIdentity();
  const [name, setName] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const user = await api.registerUser(identity, name);
      setResult(`Registered '${user.userId}' as ${user.name}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>Register User</h2>
      <p>
        Registers the currently selected identity (<strong>{identity}</strong>) as a marketplace
        user.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Display name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button type="submit">Register</button>
      </form>
      {result && <p>{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
