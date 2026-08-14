import { deleteTagEntry } from "../../_shared/glue";
import type { AppEnv } from "../../_shared/auth";

export const onRequestDelete: PagesFunction<AppEnv> = async ({ env, params, request, executionCtx }) =>
  deleteTagEntry(request, env, String(params.id), executionCtx);
