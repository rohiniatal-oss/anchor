import { apiRequest, queryClient } from "./queryClient";

export async function mutateAndInvalidate(method: string, url: string, data: unknown | undefined, invalidateKeys: string[]) {
  const res = await apiRequest(method, url, data);
  const body = await res.json().catch(() => ({}));
  await Promise.all(invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  return body;
}
