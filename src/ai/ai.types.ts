export type AiOrderProduct = {
  name: string;
  quantity: number;
};

export type AiReply = {
  reply: string;
  intent:
    | 'browse'
    | 'order'
    | 'confirm'
    | 'question'
    | 'view_cart'
    | 'update_cart'
    | 'remove_from_cart';
  products: AiOrderProduct[];
  action: 'none' | 'confirm_order' | 'create_order' | 'request_payment';
};
