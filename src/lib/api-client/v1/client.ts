import { type ApiFetchOptions, apiFetch } from "./fetcher";

export const apiClient = {
  get<T>(path: string, options?: ApiFetchOptions): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "GET" });
  },
  post<T>(path: string, body?: unknown, options?: ApiFetchOptions): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "POST", body });
  },
  put<T>(path: string, body?: unknown, options?: ApiFetchOptions): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "PUT", body });
  },
  patch<T>(path: string, body?: unknown, options?: ApiFetchOptions): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "PATCH", body });
  },
  delete<T>(path: string, options?: ApiFetchOptions): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "DELETE" });
  },
};
