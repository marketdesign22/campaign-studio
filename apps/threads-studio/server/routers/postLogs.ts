import { z } from "zod";
import { listPostLogs } from "../db";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";

export const postLogsRouter = router({
  list: accountProcedure
    .input(z.object({ limit: z.number().int().max(200).default(50) }).optional())
    .query(({ input, ctx }) => listPostLogs(input?.limit ?? 50, ctx.scope)),
});
