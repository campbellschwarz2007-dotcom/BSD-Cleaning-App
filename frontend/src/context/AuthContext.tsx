import React, { createContext, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { setCurrentUser, User } from "@/src/api";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (u: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

const KEY = "gobigred_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<any>(KEY, null);
      if (saved && saved.id) {
        setCurrentUser(saved);
        setUser(saved);
      }
      setLoading(false);
    })();
  }, []);

  const signIn = async (u: User) => {
    setCurrentUser(u);
    setUser(u);
    await storage.setItem(KEY, u as any);
  };

  const signOut = async () => {
    setCurrentUser(null);
    setUser(null);
    await storage.removeItem(KEY);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
