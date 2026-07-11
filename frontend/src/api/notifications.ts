import api from "./client";
import type {
  NotificationChannel,
  NotificationChannelCreate,
  NotificationChannelUpdate,
  NotificationTestResult,
} from "../types";

interface Page<T> {
  items: T[];
  total: number;
}

export function listNotificationChannels() {
  return api.get<Page<NotificationChannel>>("/notification-channels/").then((r) => r.data);
}

export function getNotificationEventKeys() {
  return api.get<string[]>("/notification-channels/event-keys").then((r) => r.data);
}

export function createNotificationChannel(body: NotificationChannelCreate) {
  return api.post<NotificationChannel>("/notification-channels/", body).then((r) => r.data);
}

export function updateNotificationChannel(id: number, body: NotificationChannelUpdate) {
  return api.patch<NotificationChannel>(`/notification-channels/${id}`, body).then((r) => r.data);
}

export function deleteNotificationChannel(id: number) {
  return api.delete(`/notification-channels/${id}`).then((r) => r.data);
}

export function testNotificationChannel(id: number) {
  return api.post<NotificationTestResult>(`/notification-channels/${id}/test`).then((r) => r.data);
}
