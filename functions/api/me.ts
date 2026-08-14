import { handleMe } from "../_shared/glue";
import type { AppEnv } from "../_shared/auth";

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, request }) =>
  handleMe(request, env);
