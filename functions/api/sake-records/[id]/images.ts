import { addSakeRecordImageEntry } from "../../../_shared/glue";
import type { AppEnv } from "../../../_shared/auth";

export const onRequestPost: PagesFunction<AppEnv> = async ({ env, params, request, executionCtx }) =>
  addSakeRecordImageEntry(request, env, String(params.id), executionCtx);
