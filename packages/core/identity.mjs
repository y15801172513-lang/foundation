export const eventStatusInstanceId = (pageId, eventId, status) => `event_status_${pageId}_${eventId}_${status}`;
export const validEventStatusIdentity = ({pageId, eventId, status, instanceId}) => Boolean(pageId && eventId) && ['current', 'archived', 'deleted'].includes(status) && instanceId === eventStatusInstanceId(pageId, eventId, status);

export const eventCardInstanceId = (pageId, eventId) => `event_card_${pageId}_${eventId}`;
export const validEventCardIdentity = ({pageId, eventId, instanceId}) => Boolean(pageId && eventId) && instanceId === eventCardInstanceId(pageId, eventId);
