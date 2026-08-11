import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { notifyLocal } from "@/src/utils/notify";

/**
 * Global background poller that fires a local pop-up notification whenever a
 * new message from someone else arrives while the app is open. Renders nothing.
 */
export default function MessageNotifier() {
  const { user } = useAuth();
  const seen = useRef<Record<string, string>>({});
  const primed = useRef(false);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (!user || Platform.OS === "web") return;

    primed.current = false;
    seen.current = {};

    const poll = async () => {
      try {
        const convos = await api.conversations(user.id);
        for (const c of convos) {
          const lm = c.last_message;
          if (!lm) continue;
          const prev = seen.current[c.id];
          seen.current[c.id] = lm.created_at;
          if (!primed.current) continue; // baseline pass: don't notify old msgs
          if (lm.created_at !== prev && lm.sender_id && lm.sender_id !== user.id) {
            const isAll = c.type === "all";
            const title = isAll ? "All Chatroom" : lm.sender_name || c.display_name;
            const body = isAll
              ? `${lm.sender_name?.split(" ")[0] || ""}: ${lm.text}`
              : lm.text;
            notifyLocal(title, body, { action_url: `/chat/${c.id}` });
          }
        }
        primed.current = true;
      } catch {
        // ignore transient network errors
      }
    };

    poll();
    timer.current = setInterval(poll, 8000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") poll();
    });

    return () => {
      clearInterval(timer.current);
      sub.remove();
    };
  }, [user?.id]);

  return null;
}
