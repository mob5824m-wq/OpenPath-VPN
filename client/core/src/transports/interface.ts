export interface Transport {
  name: string;
  connect(url: string, opts?: { headers?: Record<string,string> }): Promise<void>;
  send(data: Uint8Array | string): void;
  close(): void;
  onMessage: ((data: Uint8Array | string)=>void) | null;
  onClose: ((e:any)=>void) | null;
  onOpen: (()=>void) | null;
  onError: ((e:any)=>void) | null;
}
