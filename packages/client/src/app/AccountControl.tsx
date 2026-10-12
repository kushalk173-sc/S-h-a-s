import { useState } from 'react';
import { useHexclaveApp, useUser } from '@hexclave/react';

/**
 * Hosted sign-in. The table still seats people by the name they type; this
 * only opens the Hexclave account pages.
 */
export function AccountControl() {
  const app = useHexclaveApp();
  const user = useUser();
  const [pending, setPending] = useState<'in' | 'out' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(which: 'in' | 'out'): Promise<void> {
    setError(null);
    setPending(which);
    try {
      if (which === 'in') await app.redirectToSignIn();
      else await app.redirectToSignOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the account page');
      setPending(null);
    }
  }

  const account = user !== null && !user.isAnonymous ? user : null;
  const label = account?.displayName || account?.primaryEmail || null;

  return (
    <div className="account">
      {account ? (
        <button type="button" className="btn" disabled={pending !== null} onClick={() => void go('out')}>
          {pending === 'out' ? 'Signing out…' : label !== null ? `Sign out (${label})` : 'Sign out'}
        </button>
      ) : (
        <button type="button" className="btn" disabled={pending !== null} onClick={() => void go('in')}>
          {pending === 'in' ? 'Opening sign-in…' : 'Sign in'}
        </button>
      )}
      {error !== null ? (
        <p className="panel__note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
