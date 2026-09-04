/* eslint-disable react-refresh/only-export-components */
import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PostingSlot } from "@shared/postingSlots";
import { trpc } from "@/lib/trpc";
import {
  getSelectedAccountId, setSelectedAccountId, subscribeSelectedAccount,
} from "@/lib/accountStore";

export type SwitchableAccount = {
  id: number;
  name: string;
  threadsUserId: string;
  /** 投稿枠。画面のスロット表示（「12:00 JST」など）に使う */
  slots: PostingSlot[];
  active: boolean;
};

type AccountContextValue = {
  accounts: SwitchableAccount[];
  /** 操作できるアカウントが1つ以上あるか。false の間はアカウント依存のAPIを呼ばない */
  hasAccounts: boolean;
  /** 選択中アカウント。読み込み中・未登録時は null */
  current: SwitchableAccount | null;
  isLoading: boolean;
  select: (id: number) => void;
};

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  hasAccounts: false,
  current: null,
  isLoading: true,
  select: () => {},
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = trpc.accounts.list.useQuery(undefined, { staleTime: 30_000 });

  const accounts = useMemo<SwitchableAccount[]>(
    () =>
      (data ?? [])
        .filter((a) => a.active)
        .map((a) => ({
          id: a.id,
          name: a.name,
          threadsUserId: a.threadsUserId,
          slots: a.slots,
          active: a.active,
        })),
    [data]
  );

  // 選択中アカウントはReactの外（localStorage）で持っているので、購読して再描画させる。
  // ここを素の getSelectedAccountId() にすると、切り替えても画面が更新されない。
  const stored = useSyncExternalStore(subscribeSelectedAccount, getSelectedAccountId);
  const current = accounts.find((a) => a.id === stored) ?? accounts[0] ?? null;

  // 保存されていたIDが削除・無効化されていた場合は既定アカウントへ戻す。
  // （そのままだとサーバーが全リクエストを拒否して画面が動かなくなる）
  useEffect(() => {
    if (isLoading || !current) return;
    if (stored !== current.id) setSelectedAccountId(current.id);
  }, [isLoading, current, stored]);

  const select = useCallback(
    (id: number) => {
      if (id === getSelectedAccountId()) return;
      setSelectedAccountId(id);
      // 直前のアカウントのデータが一瞬でも見えないよう、取得済みの値を捨てて引き直す。
      // clear() だと購読中のクエリごと消えて再取得が走らないので resetQueries を使う。
      queryClient.resetQueries();
    },
    [queryClient]
  );

  return (
    <AccountContext.Provider
      value={{ accounts, hasAccounts: accounts.length > 0, current, isLoading, select }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
