import { z } from "zod";
import { createCategory, deleteCategory, listCategories } from "../db";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";

export const categoriesRouter = router({
  list: accountProcedure.query(({ ctx }) => listCategories(ctx.scope)),
  create: accountProcedure
    .input(z.object({ name: z.string().min(1).max(64), color: z.string().default("#335B82") }))
    .mutation(async ({ input, ctx }) => {
      await createCategory(input.name, input.color, ctx.account.id);
      return { ok: true };
    }),
  delete: accountProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      await deleteCategory(input.id, ctx.scope);
      return { ok: true };
    }),
});
