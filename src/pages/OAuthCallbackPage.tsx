import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/services';
import { CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

export const OAuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMsg(`Authorization failed: ${error}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code returned from Zoho.');
      return;
    }

    if (!user) return;

    const authenticateZoho = async () => {
      try {
        const redirectUri = window.location.origin + '/oauth/callback';
        await api.users.linkZoho(user.id, redirectUri, code);
        setStatus('success');
        setTimeout(() => {
          navigate(user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' ? '/admin' : '/');
        }, 2500);
      } catch (err: any) {
        console.error(err);
        setStatus('error');
        setErrorMsg(err.message || 'Failed to link your Zoho account with the database.');
      }
    };

    authenticateZoho();
  }, [searchParams, user, navigate]);

  return (
    <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center p-4">
      <div className="bg-white rounded-[10px] border border-[#DFDFDF] w-full max-w-[420px] p-10 shadow-2xl text-center flex flex-col items-center gap-6">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-[#161616] animate-spin" />
            <div>
              <h3 className="text-sm font-bold text-[#161616] uppercase tracking-widest mb-1">Authenticating Zoho</h3>
              <p className="text-xs text-[#161616]/40">Linking your Zoho Business Mail to CRM...</p>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-50/50 border border-green-200 flex items-center justify-center text-green-500">
              <CheckCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-green-700 uppercase tracking-widest mb-1">Authenticated ✓</h3>
              <p className="text-xs text-[#161616]/50">Zoho Mail connected successfully. Redirecting you back...</p>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-50/50 border border-red-200 flex items-center justify-center text-red-500">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-red-600 uppercase tracking-widest mb-1">Connection Failed</h3>
              <p className="text-xs text-red-500 font-medium leading-relaxed mb-4">{errorMsg}</p>
              <button
                onClick={() => navigate(user && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') ? '/admin' : '/')}
                className="bg-[#161616] text-white px-6 py-2.5 rounded-[6px] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all"
              >
                Return to Workspace
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
