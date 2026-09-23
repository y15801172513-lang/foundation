import {useEffect} from 'react';
import {Toast} from '@base-ui/react/toast';
import {Button} from '@/components/ui/button';

function CopyFeedback({notice,onRetry}) {
  const manager=Toast.useToastManager();
  useEffect(()=>{
    if(!notice)return;
    manager.add({id:'copy-context',title:notice.message,timeout:notice.pending?10000:notice.failed?8000:2200,priority:'low',data:{failed:notice.failed,content:notice.content}});
  },[notice]);
  return <Toast.Portal><Toast.Viewport className="fixed right-4 bottom-4 flex w-80 max-w-full flex-col gap-2" aria-label="复制反馈">{manager.toasts.map(item=><Toast.Root key={item.id} toast={item} className="rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"><Toast.Content><Toast.Title/>{item.data?.failed?<Toast.Action render={<Button variant="link"/>} onClick={()=>onRetry(item.data.content)}>重试复制</Toast.Action>:null}</Toast.Content></Toast.Root>)}</Toast.Viewport></Toast.Portal>;
}

export function CopyToast(props) {
  return <Toast.Provider limit={1}><CopyFeedback {...props}/></Toast.Provider>;
}
