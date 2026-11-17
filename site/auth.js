// Organizer sign-in for admin.html and door.html: Supabase Auth over plain fetch.
// The session is shared by both pages through localStorage.
(() => {
  const KEY = "organizer-session";
  let session = null;
  let verifiedHash = "";
  try {
    session = JSON.parse(localStorage.getItem(KEY));
  } catch {
    // Blocked storage: sign in each visit.
  }

  function save(data) {
    session = data && {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + data.expires_in,
    };
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch {
      // The in-memory copy is enough.
    }
  }

  async function call(path, { method = "POST", body, token } = {}) {
    const response = await fetch(`${window.SUPABASE_URL}/auth/v1${path}`, {
      method,
      headers: {
        apikey: window.SUPABASE_KEY,
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.error_description || data.message || "Sign-in failed.";
      throw Object.assign(new Error(message), { status: response.status });
    }
    return data;
  }

  window.organizerAuth = {
    signedIn: () => Boolean(session),
    signOut: () => save(null),
    async signIn(email, password) {
      save(await call("/token?grant_type=password", { body: { email, password } }));
    },
    /** Uses the one-time token from an emailed link, then sets the password. */
    async setPassword(tokenHash, type, password) {
      // The link works once, so a retry after a rejected password reuses the session.
      if (verifiedHash !== tokenHash) {
        save(await call("/verify", { body: { token_hash: tokenHash, type } }));
        verifiedHash = tokenHash;
      }
      await call("/user", { method: "PUT", body: { password }, token: session.access_token });
    },
    /** A current access token, refreshed when near expiry; "" when signed out. */
    async token() {
      if (!session) return "";
      if (session.expires_at * 1000 - Date.now() < 60_000) {
        try {
          save(await call("/token?grant_type=refresh_token", { body: { refresh_token: session.refresh_token } }));
        } catch (error) {
          if (error.status >= 400 && error.status < 500) save(null);
          else throw error;
          return "";
        }
      }
      return session.access_token;
    },
  };
})();
