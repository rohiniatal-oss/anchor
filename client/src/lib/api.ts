import { apiRequest, queryClient } from "./queryClient";

export async function mutateAndInvalidate(method: string, url: string, data: unknown | undefined, invalidateKeys: string[]) {
  const res = await apiRequest(method, url, data);
  for (const key of invalidateKeys) queryClient.invalidateQueries({ queryKey: [key] });
  return res.json().catch(() => ({}));
}
