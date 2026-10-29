// client for the chatbor library endpoints (served by the Openclaw bridge,
// same-origin at /api/openclaw). Every call is owner-scoped by the supabase JWT
const BASE = '/api/openclaw';

export type LibraryPlot = {
    id: string; name: string; createdAt: string; thumbnailUrl: string | null; spec?: unknown; pdfUrl?: string | null;
};
export type LibraryArtifact = {
    id: string; name: string; kind: string; mimeType: string; createdAt: string; downloadUrl: string;
};
export type LibraryResponse = { plots: LibraryPlot[]; artifacts: LibraryArtifact[]; };

async function request(path: string, token: string, init?: RequestInit){
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init?.headers ?? {}),
        },
    });
    if (!res.ok){
        let message = `Request failed (${res.status})`;
        try {
            const body = await res.json();
            if (body?.error) message = body.error;
        } catch {
            // Ignore
        }
        throw new Error(message);
    }
    return res.status === 204 ? null : res.json()
}

export const fetchLibrary = (token: string): Promise<LibraryResponse> => request('/library', token);
export const renamePlot = (token: string, id: string, title: string) =>
  request(`/plots/${id}`, token, { method: "PATCH", body: JSON.stringify({ title }) });
export const renameArtifact = (token: string, id: string, filename: string) =>
  request(`/artifacts/${id}`, token, { method: "PATCH", body: JSON.stringify({ filename }) });
export const deletePlot = (token: string, id: string) =>
  request(`/plots/${id}`, token, { method: "DELETE" });
export const deleteArtifact = (token: string, id: string) =>
  request(`/artifacts/${id}`, token, { method: "DELETE" });