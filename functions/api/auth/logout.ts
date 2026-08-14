import { handleLogout } from "../../_shared/glue";
import type { AppEnv } from "../../_shared/auth";

export const onRequestPost: PagesFunction<AppEnv> = async ({ env, request }) =>
  handleLogout(request, env);
