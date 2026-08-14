import { deleteSakeRecordImageEntry } from "../../../../_shared/glue";
import type { AppEnv } from "../../../../_shared/auth";

export const onRequestDelete: PagesFunction<AppEnv> = async ({ env, params, request, executionCtx }) =>
  deleteSakeRecordImageEntry(request, env, String(params.id), String(params.imageId), executionCtx);
