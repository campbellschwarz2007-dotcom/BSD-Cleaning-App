import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type User = {
  id: string;
  name: string;
  role: "cleaner" | "teacher" | "boss" | "admin";
};

let currentUser: User | null = null;

export function setCurrentUser(u: User | null) {
  currentUser = u;
}

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (currentUser) {
    headers["x-user-id"] = currentUser.id;
    headers["x-user-role"] = currentUser.role;
  }
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = (data && data.detail) || "Something went wrong";
    throw new Error(typeof message === "string" ? message : "Request failed");
  }
  return data;
}

export const api = {
  // auth
  signin: (body: { role: string; name?: string; password?: string; pin?: string }) =>
    request("/auth/signin", { method: "POST", body: JSON.stringify(body) }),
  pinStatus: (body: { role: string; name: string }) =>
    request("/auth/pin-status", { method: "POST", body: JSON.stringify(body) }),
  users: (role?: string) => request(`/users${role ? `?role=${role}` : ""}`),
  resetPin: (userId: string) =>
    request(`/users/${userId}/reset-pin`, { method: "POST" }),
  deleteUser: (userId: string) =>
    request(`/users/${userId}`, { method: "DELETE" }),

  // buildings & rooms
  buildings: () => request("/buildings"),
  createBuilding: (body: any) =>
    request("/buildings", { method: "POST", body: JSON.stringify(body) }),
  updateBuilding: (id: string, body: any) =>
    request(`/buildings/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteBuilding: (id: string) => request(`/buildings/${id}`, { method: "DELETE" }),

  // floors
  floors: (buildingId?: string) =>
    request(`/floors${buildingId ? `?building_id=${buildingId}` : ""}`),
  createFloor: (body: { building_id: string; name: string; blueprint_image?: string }) =>
    request("/floors", { method: "POST", body: JSON.stringify(body) }),
  updateFloor: (id: string, body: { name?: string; blueprint_image?: string }) =>
    request(`/floors/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteFloor: (id: string) => request(`/floors/${id}`, { method: "DELETE" }),

  rooms: (params: { buildingId?: string; floorId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.buildingId) q.set("building_id", params.buildingId);
    if (params.floorId) q.set("floor_id", params.floorId);
    const qs = q.toString();
    return request(`/rooms${qs ? `?${qs}` : ""}`);
  },
  createRoom: (body: any) =>
    request("/rooms", { method: "POST", body: JSON.stringify(body) }),
  updateRoom: (id: string, body: any) =>
    request(`/rooms/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  setRoomStatus: (id: string, status: string) =>
    request(`/rooms/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteRoom: (id: string) => request(`/rooms/${id}`, { method: "DELETE" }),

  // memos & photos
  memos: (roomId: string) => request(`/rooms/${roomId}/memos`),
  addMemo: (roomId: string, text: string) =>
    request(`/rooms/${roomId}/memos`, { method: "POST", body: JSON.stringify({ text }) }),
  addRoomPhoto: (roomId: string, image: string) =>
    request(`/rooms/${roomId}/photos`, { method: "POST", body: JSON.stringify({ image }) }),
  deleteRoomPhoto: (roomId: string, index: number) =>
    request(`/rooms/${roomId}/photos/${index}`, { method: "DELETE" }),

  // room checklist
  toggleChecklist: (roomId: string, itemId: string) =>
    request(`/rooms/${roomId}/checklist/toggle`, {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    }),
  addChecklistItem: (roomId: string, text: string) =>
    request(`/rooms/${roomId}/checklist`, { method: "POST", body: JSON.stringify({ text }) }),
  deleteChecklistItem: (roomId: string, itemId: string) =>
    request(`/rooms/${roomId}/checklist/${itemId}`, { method: "DELETE" }),

  // visits
  visits: (params: { room_id?: string; teacher_id?: string }) => {
    const q = new URLSearchParams(params as any).toString();
    return request(`/visits${q ? `?${q}` : ""}`);
  },
  addVisit: (roomId: string, date: string) =>
    request(`/rooms/${roomId}/visit`, { method: "POST", body: JSON.stringify({ date }) }),

  // tasks
  tasks: (params: { assigned_to?: string; room_id?: string } = {}) => {
    const q = new URLSearchParams(params as any).toString();
    return request(`/tasks${q ? `?${q}` : ""}`);
  },
  createTask: (body: any) =>
    request("/tasks", { method: "POST", body: JSON.stringify(body) }),
  completeTask: (id: string) => request(`/tasks/${id}/complete`, { method: "POST" }),
  redoTask: (id: string) => request(`/tasks/${id}/redo`, { method: "POST" }),
  taskSummary: (date?: string) => request(`/tasks/summary${date ? `?date=${date}` : ""}`),

  // chat
  conversations: (userId: string) => request(`/conversations?user_id=${userId}`),
  createConversation: (body: any) =>
    request("/conversations", { method: "POST", body: JSON.stringify(body) }),
  messages: (id: string) => request(`/conversations/${id}/messages`),
  sendMessage: (id: string, text: string) =>
    request(`/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ text }) }),

  // contest
  contest: (userId?: string) =>
    request(`/contest/current${userId ? `?user_id=${userId}` : ""}`),
  submitContest: (body: { image: string; caption?: string }) =>
    request("/contest/submit", { method: "POST", body: JSON.stringify(body) }),
  vote: (id: string) => request(`/submissions/${id}/vote`, { method: "POST" }),

  // settings & numbers
  settings: () => request("/settings"),
  updateSettings: (body: any) =>
    request("/settings", { method: "PUT", body: JSON.stringify(body) }),
  numbers: () => request("/numbers"),
};

export { storage };
