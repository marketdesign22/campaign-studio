/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { getSelectedAccountId, setSelectedAccountId } from "@/lib/accountStore";

export type SwitchableAccount = {
  id: number;
  name: string;
  threadsUserId: string;
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
          active: a.active,
        })),
    [data]
  );

  const stored = getSelectedAccountId();
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
      // 直前のアカウントのデータが一瞬でも見えないよう、キャッシュを捨ててから引き直す
      queryClient.clear();
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
