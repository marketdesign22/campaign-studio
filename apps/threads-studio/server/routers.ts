import { COOKIE_NAME } from "@shared/const";
import { manualPostRouter } from "./routers/manualPost";
import { postLogsRouter } from "./routers/postLogs";
import { postsRouter } from "./routers/posts";
import { settingsRouter } from "./routers/settings";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { categoriesRouter } from "./routers/categories";
import { analyticsRouter } from "./routers/analytics";
import { accountsRouter } from "./routers/accounts";
import { aiRouter } from "./routers/ai";
import { mediaRouter } from "./routers/media";
import { trendsRouter } from "./routers/trends";
import { repliesRouter } from "./routers/replies";
import { engagementRouter } from "./routers/engagement";
import { clientProfileRouter } from "./routers/clientProfile";
import { conversionsRouter } from "./routers/conversions";
import { strategiesRouter } from "./routers/strategies";
import { qualityRouter } from "./routers/quality";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  settings: settingsRouter,
  posts: postsRouter,
  postLogs: postLogsRouter,
  manualPost: manualPostRouter,
  categories: categoriesRouter,
  analytics: analyticsRouter,
  accounts: accountsRouter,
  ai: aiRouter,
  media: mediaRouter,
  trends: trendsRouter,
  replies: repliesRouter,
  engagement: engagementRouter,
  clientProfile: clientProfileRouter,
  conversions: conversionsRouter,
  strategies: strategiesRouter,
  quality: qualityRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
