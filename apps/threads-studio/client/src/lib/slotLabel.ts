import { formatSlot, PostingSlot } from "@shared/postingSlots";

/**
 * 原稿の投稿枠を「12:00 JST」のように表示する。
 *
 * 枠ごとにタイムゾーンが違いうるので、「朝」「夕」という固定ラベルでは
 * どの時間に出るのか分からなくなる。実際に設定されている時刻を出す。
 * 枠の設定より大きい slotIndex（設定を減らした後の原稿など）は数字で示す。
 */
export function slotLabel(slots: PostingSlot[], slotIndex: number, fallbackPrefix: string): string {
  const slot = slots[slotIndex];
  return slot ? formatSlot(slot) : `${fallbackPrefix}${slotIndex + 1}`;
}
