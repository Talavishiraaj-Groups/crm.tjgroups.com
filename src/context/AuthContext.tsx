import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, UserRole } from '../types';
import { api } from '../api/services';
import { ApiError } from '../api/errors';
import { clearSession, onSessionExpired } from '../api/session';

/**
 * Session state.
 *
 * The identity here is whatever the SERVER said it is, restored by exchanging
 * the session token for the current user record. Nothing about the user —
 * least of all the role — is read back out of localStorage, because the
 * browser can edit that. The role held here drives UI presentation only;
 * every actual permission decision happens server-side.
 */

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  isLoading: boolean;
  /** Non-null when session restoration failed for a reason other than logout. */
  restoreError: ApiError | null;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [restoreError, setRestoreError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const restored = await api.auth.getSession();
        if (!cancelled) setUser(restored);
      } catch (err) {
        // A backend outage must not silently look like "logged out with no
        // explanation" — keep the reason so the login screen can show it.
        if (!cancelled) {
          setUser(null);
          setRestoreError(err instanceof ApiError ? err : null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The server can invalidate a session at any time (logout elsewhere,
  // deactivation, role change, expiry). Drop local state the moment it does.
  useEffect(() => onSessionExpired(() => setUser(null)), []);

  const login = useCallback(async (username: string, password: string) => {
    const { user: authenticated } = await api.auth.login(username, password);
    setUser(authenticated);
    setRestoreError(null);
    return authenticated;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Even if the server call fails, the local session must end.
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const current = await api.auth.getSession();
    setUser(current);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, role: user?.role ?? null, isLoading, restoreError, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// The hook is the intended public API of this module and belongs beside its
// provider. Splitting it into another file to satisfy fast-refresh would make
// the module harder to follow for no runtime benefit.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
