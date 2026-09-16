// Private subprocess binding for the single-origin lifecycle coordinator.
// IPC binds a transport only: it has no confirm/apply message or dispatch API.
let binding = null;
export async function receiveJourneyTransport() {
  if (!process.connected || typeof process.send !== 'function') throw Error('单页模式需要本次父进程的私有 IPC 通道');
  binding = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {process.off('message', accept);reject(Error('单页通道绑定超时'));}, 10000);
    function accept(message) {
      clearTimeout(timer);process.off('message', accept);
      try {
        const {type, origin, operationId, token} = message || {};
        const url = new URL(origin);
        if (type !== 'foundation-journey-bind-v1' || url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || !/^[a-zA-Z0-9-]{1,100}$/.test(operationId) || !/^[a-f0-9]{64}$/.test(token)) throw Error('单页通道身份无效');
        resolve(Object.freeze({origin, operationId, token}));
      } catch (error) {reject(error);}
    }
    process.once('message', accept);
    process.send({type:'foundation-journey-ready-v1'});
  });
  // Channel lifetime must not keep a completed manager alive.
  process.channel?.unref();
}
export function currentJourneyTransport() {return binding;}
export function isJourneyRequest(request, transport) {
  return Boolean(transport && request.headers['x-foundation-journey'] === transport.token && request.headers.origin === transport.origin && request.headers['x-foundation-operation'] === transport.operationId);
}
