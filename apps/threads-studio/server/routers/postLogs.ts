import { z } from "zod";
import { listPostLogs } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const postLogsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().max(200).default(50) }).optional())
    .query(({ input }) => listPostLogs(input?.limit ?? 50)),
});
