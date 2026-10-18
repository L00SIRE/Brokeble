import { loadByToken, pageState, savedCard } from "@/orders/authorize";

export { loadByToken, savedCard };
export const pageStateOf = (share: Parameters<typeof pageState>[0], order: Parameters<typeof pageState>[1]) => pageState(share, order, new Date());
