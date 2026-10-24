import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider.js";
import type { UpdateProfileRequest } from "@libellum/shared";

export function useSaveProfile(): (input: UpdateProfileRequest) => Promise<void> {
  const { updateProfile } = useAuth();
  const client = useQueryClient();
  return async (input) => {
    await updateProfile(input);
    // 含指定账本和当前账本的所有成员列表；不把本人的头像写到其他成员身上。
    await Promise.all([
      client.invalidateQueries({ queryKey: ["book-members"] }),
      client.invalidateQueries({ queryKey: ["directory"] }),
    ]);
  };
}
