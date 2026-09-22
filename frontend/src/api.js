import axios from 'axios';

const envApiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const baseURL = envApiBase ? `${envApiBase}/api` : '/api';

const api = axios.create({
  baseURL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

export const getServices = () =>
  api.get('/services').then((r) => r.data).catch((err) => {
    console.warn('Services API unavailable', err);
    return [];
  });

export const getContactSubjects = (serviceId) => api.get('/contact-subjects', { params: serviceId ? { serviceId } : {} }).then((r) => r.data);
export const getAdminContactSubjects = () => api.get('/admin/contact-subjects').then((r) => r.data);
export const createAdminContactSubject = (payload) => api.post('/admin/contact-subjects', payload).then((r) => r.data);
export const updateAdminContactSubject = (id, payload) => api.patch(`/admin/contact-subjects/${id}`, payload).then((r) => r.data);
export const deleteAdminContactSubject = (id) => api.delete(`/admin/contact-subjects/${id}`).then((r) => r.data);
export const reorderAdminContactSubjects = (items) => api.patch('/admin/contact-subjects/reorder', { items }).then((r) => r.data);

export const createService = (payload) => api.post('/services', payload).then((r) => r.data);
export const updateService = (id, payload) => api.patch(`/services/${id}`, payload).then((r) => r.data);
export const deleteService = (id) => api.delete(`/services/${id}`).then((r) => r.data);
export const reorderServices = (items) => api.patch('/services/reorder', { items }).then((r) => r.data);

export const loginAdmin = (payload) => api.post('/admin/login', payload).then((r) => r.data);
export const getAdminUsers = () => api.get('/admin/users').then((r) => r.data);
export const createAdminUser = (payload) => api.post('/admin/users', payload).then((r) => r.data);
export const updateAdminUser = (id, payload) => api.patch(`/admin/users/${id}`, payload).then((r) => r.data);
export const deleteAdminUser = (id) => api.delete(`/admin/users/${id}`).then((r) => r.data);
export const getAdminSettings = () => api.get('/admin/settings').then((r) => r.data);
export const saveAdminSetting = (payload) => api.post('/admin/settings', payload).then((r) => r.data);
export const getAdminCounters = () => api.get('/admin/counters').then((r) => r.data);
export const createAdminCounter = (payload) => api.post('/admin/counters', payload).then((r) => r.data);
export const updateAdminCounter = (id, payload) => api.patch(`/admin/counters/${id}`, payload).then((r) => r.data);
export const deleteAdminCounter = (id) => api.delete(`/admin/counters/${id}`).then((r) => r.data);
export const reorderAdminCounters = (items) => api.patch('/admin/counters/reorder', { items }).then((r) => r.data);

export const createQueue = (payload) => api.post('/queues', payload).then((r) => r.data);
export const getQueue = (id) => api.get(`/queues/${id}`).then((r) => r.data);
export const checkInQueue = (id) => api.post(`/queues/${id}/check-in`).then((r) => r.data);

export const getAdminQueues = (serviceId) => api.get('/admin/queues', { params: { serviceId } }).then((r) => r.data);
export const getAdminBookings = (date, serviceId) => api.get('/admin/bookings', { params: { ...(date ? { date } : {}), ...(serviceId ? { serviceId } : {}) } }).then((r) => r.data);
export const getAdminDashboard = () => api.get('/admin/dashboard').then((r) => r.data);
export const getAdminReports = (date, serviceId) => api.get('/admin/reports', { params: { date, ...(serviceId ? { serviceId } : {}) } }).then((r) => r.data);

export const getSkippedQueues = (serviceId) => api.get('/admin/queues/skipped', { params: { serviceId } }).then((r) => r.data);

export const callNext = (serviceIds, counterNo, servedBy) => {
  const normalizedIds = Array.isArray(serviceIds)
    ? serviceIds.filter((id) => id !== null && id !== undefined && id !== '')
    : serviceIds !== null && serviceIds !== undefined && serviceIds !== ''
      ? [serviceIds]
      : [];
  return api.patch('/admin/queues/next', { serviceIds: normalizedIds, counterNo, servedBy }).then((r) => r.data);
};

export const callQueue = (id, counterNo, servedBy) => api.patch(`/admin/queues/${id}/call`, { counterNo, servedBy }).then((r) => r.data);
export const recallQueue = (id, servedBy) => api.patch(`/admin/queues/${id}/recall`, { servedBy }).then((r) => r.data);
export const completeQueue = (id) => api.patch(`/admin/queues/${id}/complete`).then((r) => r.data);
export const skipQueue = (id) => api.patch(`/admin/queues/${id}/skip`).then((r) => r.data);
export const reinsertQueue = (id) => api.patch(`/admin/queues/${id}/reinsert`).then((r) => r.data);
export const cancelQueue = (id) => api.patch(`/admin/queues/${id}/cancel`).then((r) => r.data);

export const getDisplayData = () => api.get('/display').then((r) => r.data);

// Time Slots
export const getAdminTimeSlots = () => api.get('/admin/time-slots').then((r) => r.data);
export const createAdminTimeSlot = (payload) => api.post('/admin/time-slots', payload).then((r) => r.data);
export const updateAdminTimeSlot = (id, payload) => api.put(`/admin/time-slots/${id}`, payload).then((r) => r.data);
export const deleteAdminTimeSlot = (id) => api.delete(`/admin/time-slots/${id}`).then((r) => r.data);
export const getAvailableTimeSlots = (date) => api.get('/time-slots/available', { params: { date } }).then((r) => r.data);

// Announcements (Admin)
export const getAdminAnnouncements = () => api.get('/admin/announcements').then((r) => r.data);
export const createAdminAnnouncement = (payload) => api.post('/admin/announcements', payload).then((r) => r.data);
export const updateAdminAnnouncement = (id, payload) => api.put(`/admin/announcements/${id}`, payload).then((r) => r.data);
export const deleteAdminAnnouncement = (id) => api.delete(`/admin/announcements/${id}`).then((r) => r.data);

// Announcements (Public)
export const getActiveAnnouncements = (date) => api.get('/announcements/active', { params: date ? { date } : {} }).then((r) => r.data).catch(() => []);

export default api;
