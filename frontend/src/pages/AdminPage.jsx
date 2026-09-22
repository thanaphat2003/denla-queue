import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getServices,
  getAdminQueues,
  getAdminBookings,
  getAdminDashboard,
  getAdminReports,
  getSkippedQueues,
  getAdminCounters,
  callNext,
  callQueue,
  recallQueue,
  completeQueue,
  skipQueue,
  reinsertQueue,
  cancelQueue,
} from '../api.js';
import socket from '../socket.js';
import AdminTopNav from '../components/AdminTopNav.jsx';

/**
 * เรียงคิว WAITING ตาม Priority Rule (ตรงกับ backend sortByPriority):
 *   1. BOOKING isCheckedIn=true + slot เริ่มแล้ว → [slotStartTime ASC, checkedInAt ASC]
 *   2. WALK_IN → [id ASC]
 *   3. BOOKING isCheckedIn=true แต่ slot ยังไม่เริ่ม → [slotStartTime ASC, checkedInAt ASC]
 *   4. อื่นๆ → [id ASC]
 */
function sortByPriority(queues, now = new Date()) {
  const getSlotStart = (q) => {
    if (!q.bookingDate || !q.timeSlot?.startTime) return null;
    const [h, m] = q.timeSlot.startTime.split(':').map(Number);
    const raw = String(q.bookingDate);
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
    d.setHours(h, m, 0, 0);
    return d;
  };

  return [...queues].sort((a, b) => {
    const aSlotStart = getSlotStart(a);
    const bSlotStart = getSlotStart(b);
    const aSlotReady = a.queueType === 'BOOKING' && a.isCheckedIn && aSlotStart !== null && now >= aSlotStart;
    const bSlotReady = b.queueType === 'BOOKING' && b.isCheckedIn && bSlotStart !== null && now >= bSlotStart;
    const aIsWalkIn = a.queueType === 'WALK_IN';
    const bIsWalkIn = b.queueType === 'WALK_IN';

    const bucket = (q, slotReady, isWalkIn) => {
      if (slotReady) return 0;
      if (isWalkIn) return 1;
      if (q.queueType === 'BOOKING' && q.isCheckedIn) return 2;
      return 3;
    };

    const aBucket = bucket(a, aSlotReady, aIsWalkIn);
    const bBucket = bucket(b, bSlotReady, bIsWalkIn);
    if (aBucket !== bBucket) return aBucket - bBucket;

    if (aBucket === 0 || aBucket === 2) {
      const aSlot = a.timeSlot?.startTime ?? '99:99';
      const bSlot = b.timeSlot?.startTime ?? '99:99';
      if (aSlot !== bSlot) return aSlot.localeCompare(bSlot);
      return (a.checkedInAt ? new Date(a.checkedInAt).getTime() : a.id) -
             (b.checkedInAt ? new Date(b.checkedInAt).getTime() : b.id);
    }
    return a.id - b.id;
  });
}

const parseCounterNumber = (counter) => {
  if (!counter) return null;

  const direct = Number(counter.counterNo ?? counter.no ?? counter.id);
  const fromName = Number(String(counter.name || '').match(/\d+/)?.[0] ?? '0');

  if (Number.isFinite(fromName) && fromName > 0) return fromName;
  if (Number.isFinite(direct) && direct > 0) return direct;

  return null;
};

function buildDashboardData(items, fallbackServices = []) {
  const list = Array.isArray(items) && items.length > 0 ? items : fallbackServices;

  return list.map((item, index) => ({
    id: item.id ?? `${item.name ?? 'service'}-${index}`,
    name: item.name || item.service?.name || 'บริการ',
    prefix: item.prefix || item.service?.prefix || '',
    waiting: item.waiting ?? 0,
    calling: item.calling ?? 0,
    skipped: item.skipped ?? 0,
    total: item.total ?? 0,
    walkIn: item.walkIn ?? 0,
    booking: item.booking ?? 0,
  }));
}

const requireAdminAccess = (navigateFn) => {
  const isAuthenticated = sessionStorage.getItem('admin-auth') === 'true';
  const role = sessionStorage.getItem('admin-role') || 'ADMIN';
  const allowedRoles = ['ADMIN', 'MANAGER'];

  if (!isAuthenticated || !allowedRoles.includes(role)) {
    sessionStorage.removeItem('admin-auth');
    sessionStorage.removeItem('admin-role');
    navigateFn('/admin/login', { replace: true });
    return false;
  }

  return true;
};

export default function AdminPage() {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [activeServiceId, setActiveServiceId] = useState(null);
  const [counters, setCounters] = useState([]);
  const [counterNo, setCounterNo] = useState(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [queueTypeFilter, setQueueTypeFilter] = useState('ALL');
  const [queues, setQueues] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [currentCounterQueue, setCurrentCounterQueue] = useState(null);
  const [queueToCall, setQueueToCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dashboard, setDashboard] = useState([]);
  const [report, setReport] = useState({ open: false, date: new Date().toISOString().slice(0, 10), service: null, items: [] });
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
  const [showAllBookings, setShowAllBookings] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [restoreCancelledModalOpen, setRestoreCancelledModalOpen] = useState(false);
  const operatorName = sessionStorage.getItem('admin-username') || '';

  useEffect(() => {
    if (!requireAdminAccess(navigate)) return;

    Promise.all([getServices(), getAdminDashboard().catch(() => []), getAdminCounters().catch(() => [])])
      .then(([list, dashboardList, counterList]) => {
        setServices(list);
        setCounters(counterList);
        if (list[0]) setActiveServiceId(list[0].id);
        if (counterList[0]) setCounterNo(parseCounterNumber(counterList[0]));
        setDashboard(buildDashboardData(dashboardList, list));
      })
      .catch(() => {
        setServices([]);
        setCounters([]);
        setDashboard([]);
      });
  }, [navigate]);

  useEffect(() => {
    getAdminBookings(showAllBookings ? undefined : bookingDate)
      .then((items) => setBookings(Array.isArray(items) ? items : []))
      .catch(() => setBookings([]));
  }, [bookingDate, showAllBookings]);

  useEffect(() => {
    if (!activeServiceId) return;
    refresh();
    socket.emit('subscribe:service', activeServiceId);

    const onBoard = () => refresh();
    const onDashboardUpdate = () => { refresh(); refreshBookings(); };
    socket.on('queue:board', onBoard);
    socket.on('dashboard:update', onDashboardUpdate);
    socket.on('queue:skipped', refresh);
    socket.on('queue:reinserted', refresh);

    return () => {
      socket.off('queue:board', onBoard);
      socket.off('dashboard:update', onDashboardUpdate);
      socket.off('queue:skipped');
      socket.off('queue:reinserted');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServiceId, selectedServiceIds, services]);

  const effectiveServiceIds = useMemo(() => {
    if (selectedServiceIds.length > 0) return selectedServiceIds;
    return activeServiceId ? [activeServiceId] : [];
  }, [selectedServiceIds, activeServiceId]);

  const allServicesSelected = useMemo(
    () => services.length > 0 && services.every((service) => selectedServiceIds.includes(service.id)),
    [services, selectedServiceIds]
  );

  const refresh = () => {
    const serviceIds = effectiveServiceIds.length > 0 ? effectiveServiceIds : services.map((service) => service.id);

    if (serviceIds.length === 0) {
      setQueues([]);
      setSkipped([]);
      return;
    }

    Promise.all([
      Promise.all(serviceIds.map((serviceId) => getAdminQueues(serviceId).catch(() => []))).then((queueLists) =>
        setQueues(queueLists.flat().sort((a, b) => Number(a.id) - Number(b.id)))
      ),
      Promise.all(serviceIds.map((serviceId) => getSkippedQueues(serviceId).catch(() => []))).then((skippedLists) =>
        setSkipped(skippedLists.flat().sort((a, b) => Number(a.id) - Number(b.id)))
      ),
      getAdminDashboard().catch(() => []).then((dashboardList) => setDashboard(buildDashboardData(dashboardList, services))),
      getAdminCounters().catch(() => []).then((counterList) => setCounters(counterList)),
    ]);
  };

  useEffect(() => {
    if (!services.length) {
      setQueues([]);
      setSkipped([]);
      return;
    }

    refresh();
  }, [services, effectiveServiceIds]);

  const filteredQueues = useMemo(
    () => {
      if (queueTypeFilter === 'ALL') return queues;
      return queues.filter((q) => q.queueType === queueTypeFilter);
    },
    [queueTypeFilter, queues]
  );

  const sortedBookings = useMemo(() => [...bookings].sort((a, b) => {
    const dateDifference = new Date(a.bookingDate).getTime() - new Date(b.bookingDate).getTime();
    if (dateDifference !== 0) return dateDifference;
    const slotDifference = (a.timeSlotId ?? 0) - (b.timeSlotId ?? 0);
    if (slotDifference !== 0) return slotDifference;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }), [bookings]);

  const calling = useMemo(() => filteredQueues.filter((q) => q.status === 'CALLING'), [filteredQueues]);
  const waiting = useMemo(() => {
    const w = filteredQueues.filter((q) => q.status === 'WAITING');
    return sortByPriority(w);
  }, [filteredQueues]);

  const callingByCounter = useMemo(() => {
    const groups = new Map();

    calling.forEach((queue) => {
      const serviceId = queue.serviceId ?? queue.service?.id ?? 'unknown';
      const serviceName = queue.service?.name || services.find((service) => service.id === serviceId)?.name || 'บริการ';
      const counterNoValue = Number(queue.counterNo);
      if (!Number.isFinite(counterNoValue) || counterNoValue <= 0) return;
      const key = `counter-${counterNoValue}`;

      if (!groups.has(key)) {
        groups.set(key, {
          counterNo: counterNoValue,
          serviceId,
          serviceName,
          queue: queue,
        });
      }
    });

    return Array.from(groups.values()).sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  }, [calling, services]);

  useEffect(() => {
    if (!counterNo) {
      setCurrentCounterQueue(null);
      return;
    }

    getAdminQueues()
      .then((allQueues) =>
        setCurrentCounterQueue(
          allQueues.find((queue) => queue.status === 'CALLING' && Number(queue.counterNo) === Number(counterNo)) || null
        )
      )
      .catch(() => setCurrentCounterQueue(null));
  }, [counterNo, queues]);

  const selectedCounterQueue = currentCounterQueue;

  const callingSummary = useMemo(() => {
    const summary = Array.isArray(counters)
      ? counters.map((counter) => {
          const number = parseCounterNumber(counter);
          if (!number) return null;
          const matched = calling.find((queue) => Number(queue.counterNo) === number) || null;
          return {
            counterNo: number,
            ticketNo: matched?.ticketNo || '—',
            serviceName: matched?.service?.name || services.find((service) => service.id === matched?.serviceId)?.name || 'ว่าง',
          };
        })
      : [];

    return summary.filter(Boolean).sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  }, [calling, counters, services]);

  const formatWaitDuration = (queue) => {
    if (!queue) return '0 นาที';
    const baseTime = queue.checkedInAt ? new Date(queue.checkedInAt) : new Date(queue.createdAt);
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(baseTime).getTime()) / 1000));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins} นาที ${secs} วินาที`;
  };

  const isBookingDelayed = (queue) => {
    if (queue?.queueType !== 'BOOKING' || !['WAITING', 'SKIPPED'].includes(queue?.status) || !queue?.bookingDate || !queue?.timeSlot?.startTime) {
      return false;
    }

    const [hours, minutes] = String(queue.timeSlot.startTime || '00:00').split(':').map(Number);
    const slotDate = new Date(queue.bookingDate);
    slotDate.setHours(hours || 0, minutes || 0, 0, 0);
    const [endHours, endMinutes] = String(queue.timeSlot.endTime || queue.timeSlot.startTime || '00:00').split(':').map(Number);
    slotDate.setHours(endHours || 0, endMinutes || 0, 0, 0);
    return new Date() > slotDate;
  };

  const isExpiredBooking = (queue) => queue?.queueType === 'BOOKING' && queue?.status === 'SKIPPED' && isBookingDelayed(queue);
  const bookingStatusLabel = (queue) => {
    if (isExpiredBooking(queue)) return 'Booking เลยเวลาจอง';
    if (queue.status === 'CANCELLED') return 'ยกเลิก';
    if (queue.status === 'COMPLETED') return 'เสร็จสิ้น';
    if (queue.status === 'CALLING') return 'กำลังเรียก';
    if (queue.queueType === 'BOOKING' && !queue.isCheckedIn) return 'ยังไม่ Check-in';
    if (queue.queueType === 'BOOKING' && queue.isCheckedIn) return 'มาถึงแล้ว';
    return 'รอเรียก';
  };

  const bookingStatusClass = (queue) => {
    if (queue.status === 'CANCELLED') return 'text-danger';
    if (queue.status === 'COMPLETED') return 'text-ink-muted';
    return queue.isCheckedIn ? 'text-success' : 'text-warning';
  };

  const waitingByService = useMemo(() => {
    const groups = new Map();

    waiting.forEach((queue) => {
      const serviceId = queue.serviceId ?? queue.service?.id ?? 'unknown';
      const serviceName = queue.service?.name || services.find((service) => service.id === serviceId)?.name || '';
      if (!groups.has(serviceId)) {
        groups.set(serviceId, { serviceId, serviceName, items: [] });
      }
      groups.get(serviceId).items.push(queue);
    });

    return Array.from(groups.values()).sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'th'));
  }, [waiting, services]);

  const statusQueues = useMemo(() => {
    const statusPriority = { SKIPPED: 0, COMPLETED: 1, CANCELLED: 2 };

    return queues
      .filter((queue) => ['SKIPPED', 'COMPLETED', 'CANCELLED'].includes(queue.status))
      .sort((a, b) => {
        const priorityDifference = statusPriority[a.status] - statusPriority[b.status];
        if (priorityDifference !== 0) return priorityDifference;
        return new Date(b.updatedAt || b.completedAt || b.createdAt) - new Date(a.updatedAt || a.completedAt || a.createdAt);
      });
  }, [queues]);

  const cancelledQueues = useMemo(
    () => queues.filter((queue) => queue.status === 'CANCELLED'),
    [queues]
  );

  const toggleServiceSelection = (serviceId) => {
    setSelectedServiceIds((prev) => {
      const isSelected = prev.includes(serviceId);
      const next = isSelected ? prev.filter((id) => id !== serviceId) : [...prev, serviceId];
      setActiveServiceId(serviceId);
      return next;
    });
  };

  const selectAllServices = () => {
    const allIds = services.map((service) => service.id);
    setSelectedServiceIds(allIds);
    if (allIds[0]) setActiveServiceId(allIds[0]);
  };

  const clearSelectedServices = () => {
    setSelectedServiceIds([]);
    setActiveServiceId(services[0]?.id ?? null);
  };

  const withBusy = (fn) => async (...args) => {
    setBusy(true);
    try {
      await fn(...args);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleNext = withBusy(() => callNext(effectiveServiceIds.length > 0 ? effectiveServiceIds : [activeServiceId], counterNo, operatorName));
  const handleRecall = withBusy((id) => recallQueue(id, operatorName));
  const handleComplete = withBusy((id) => completeQueue(id));
  const handleSkip = withBusy((id) => skipQueue(id));
  const handleReinsert = withBusy((id) => reinsertQueue(id));
  const handleCancel = withBusy((id) => cancelQueue(id));
  const handleRestoreCancelled = async (id) => {
    await handleReinsert(id);
    setRestoreCancelledModalOpen(false);
  };
  const refreshBookings = async () => {
    const items = await getAdminBookings(showAllBookings ? undefined : bookingDate).catch(() => []);
    setBookings(Array.isArray(items) ? items : []);
  };
  const handleBookingAction = async (action, id) => {
    setBusy(true);
    try {
      await action(id);
      await refreshBookings();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const confirmCallWaitingQueue = async () => {
    if (!queueToCall) return;

    await withBusy(() => callQueue(queueToCall.id, counterNo, operatorName))();
    setQueueToCall(null);
  };

  const openReport = async (item) => {
    const date = new Date().toISOString().slice(0, 10);
    const items = await getAdminReports(date, item.id).catch(() => []);
    setReport({ open: true, date, service: item, items });
  };

  const loadReport = async (date) => {
    const items = await getAdminReports(date, report.service?.id).catch(() => []);
    setReport((prev) => ({ ...prev, date, items }));
  };

  const formatDuration = (seconds) => `${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`;
  const formatBookingTime = (value) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';

  const exportReport = () => {
    const header = ['รหัสคิว', 'หมายเลขคิว', 'ประเภทบริการ', 'เรื่องที่มาติดต่อ (ไทย)', 'เรื่องที่มาติดต่อ (อังกฤษ)', 'ภาษา', 'ชื่อ-นามสกุลผู้จอง', 'เบอร์โทรศัพท์', 'อีเมล', 'สถานะ', 'ช่องบริการ', 'ผู้ให้บริการ', 'เวลาจองคิว', 'เวลาเริ่มบริการ', 'เวลาเสร็จสิ้น', 'เวลารอ', 'เวลารับบริการ', 'เวลารวม'];
    const rows = report.items.map((item) => [item.id, item.ticketNo, item.service?.name || '', item.contactSubject || '', item.contactSubjectEn || '', item.language || '', item.userName || '', item.userPhone || '', item.userEmail || '', item.status, item.counterNo || '', item.servedBy || '', item.createdAt, item.serviceStartedAt || '', item.completedAt || '', formatDuration(item.waitingSeconds), formatDuration(item.serviceSeconds), formatDuration(item.totalSeconds)]);
    const csv = '\ufeff' + [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `queue-report-${report.date}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportBookings = () => {
    const header = ['รหัสคิว', 'หมายเลขคิว', 'ประเภท', 'ผู้จอง', 'เบอร์โทรศัพท์', 'อีเมล', 'บริการ', 'ช่วงเวลาเข้ารับบริการ', 'เวลาที่จอง', 'เวลา Check-in', 'สถานะ'];
    const rows = sortedBookings.map((item) => [
      item.id,
      item.ticketNo,
      item.queueType,
      item.userName,
      item.userPhone,
      item.userEmail,
      item.service?.name || '',
      item.timeSlot ? `${item.timeSlot.startTime} - ${item.timeSlot.endTime}` : '',
      item.createdAt,
      item.checkedInAt || '',
      item.status,
    ]);
    const csv = '\ufeff' + [header, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `bookings-${showAllBookings ? 'all' : bookingDate}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="min-h-screen bg-canvas font-body">
      {report.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div><h2 className="font-display text-xl text-primary">รายงานคิว: {report.service?.name}</h2><p className="text-xs text-ink-muted">รวม {report.items.length} คิว</p></div>
              <div className="flex gap-2"><input type="date" value={report.date} onChange={(e) => loadReport(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" /><button type="button" onClick={exportReport} className="rounded-lg bg-success px-3 py-2 text-sm text-white">ดาวน์โหลด Excel</button><button type="button" onClick={() => setReport((prev) => ({ ...prev, open: false }))} className="rounded-lg border px-3 py-2 text-sm">ปิด</button></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {['WAITING', 'CALLING', 'COMPLETED', 'SKIPPED'].map((status) => <div key={status} className="rounded-xl bg-primary/5 p-3"><p className="text-xs text-ink-muted">{status}</p><p className="text-xl font-semibold text-primary">{report.items.filter((item) => item.status === status).length}</p></div>)}
            </div>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">คิว</th><th className="p-2">ประเภท</th><th className="p-2">เรื่อง</th><th className="p-2">ผู้จอง</th><th className="p-2">สถานะ</th><th className="p-2">เวลารอ</th><th className="p-2">เวลารับบริการ</th><th className="p-2">เวลารวม</th></tr></thead><tbody>{report.items.map((item) => <tr key={item.id} className="border-b border-ink/10"><td className="p-2 font-semibold">{item.ticketNo}</td><td className="p-2">{item.queueType === 'BOOKING' ? 'Booking' : 'Walk-in'}</td><td className="p-2">{item.contactSubject || '-'}</td><td className="p-2">{item.userName}</td><td className="p-2">{item.status}</td><td className="p-2">{formatDuration(item.waitingSeconds)}</td><td className="p-2">{formatDuration(item.serviceSeconds)}</td><td className="p-2">{formatDuration(item.totalSeconds)}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      )}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-5">
          <div className="w-full max-w-6xl max-h-[94vh] overflow-auto rounded-2xl bg-white p-4 sm:p-6 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-display text-xl text-primary">รายการจอง{showAllBookings ? 'ทั้งหมด' : `วันที่ ${bookingDate}`}</h2>
                <p className="text-xs text-ink-muted">รวม {sortedBookings.length} รายการ</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={exportBookings} className="rounded-lg bg-success px-3 py-2 text-sm text-white">ส่งออก Excel</button>
                <button type="button" onClick={() => setBookingModalOpen(false)} className="rounded-lg border px-3 py-2 text-sm">ปิด</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-ink/10"><th className="p-2">คิว</th><th className="p-2">ผู้จอง</th><th className="p-2">เบอร์โทรศัพท์</th><th className="p-2">บริการ</th><th className="p-2">ช่วงเวลา</th><th className="p-2">เวลาที่จอง</th><th className="p-2">สถานะ</th></tr></thead>
                <tbody>{sortedBookings.map((item) => (
                  <tr key={item.id} className="border-b border-ink/10">
                    <td className="p-2 font-semibold text-primary">{item.ticketNo}</td>
                    <td className="p-2">{item.userName}</td>
                    <td className="p-2">{item.userPhone}</td>
                    <td className="p-2">{item.service?.name || '-'}</td>
                    <td className="p-2">{item.timeSlot ? `${item.timeSlot.startTime} - ${item.timeSlot.endTime}` : '-'}</td>
                    <td className="p-2 whitespace-nowrap">{formatBookingTime(item.createdAt)}</td>
                    <td className="p-2"><span className={bookingStatusClass(item)}>{bookingStatusLabel(item)}</span>{item.status === 'SKIPPED' && <div className="mt-1 flex gap-2"><button type="button" onClick={() => handleBookingAction(reinsertQueue, item.id)} disabled={busy} className="text-xs text-primary underline">ดึงกลับ</button><button type="button" onClick={() => handleBookingAction(cancelQueue, item.id)} disabled={busy} className="text-xs text-danger underline">ยกเลิก</button></div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <AdminTopNav />

      <div className="max-w-6xl mx-auto px-5 py-6">
        {/* Service tabs */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <p className="text-xs text-ink-muted">เลือกบริการที่ต้องการดู/เรียกคิว</p>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink-muted">
                <span>กรองคิว</span>
                <select value={queueTypeFilter} onChange={(e) => setQueueTypeFilter(e.target.value)} className="bg-transparent focus:outline-none">
                  <option value="ALL">ทั้งหมด</option>
                  <option value="WALK_IN">เฉพาะ Walk-in</option>
                  <option value="BOOKING">เฉพาะ Booking</option>
                </select>
              </label>
              <button
                type="button"
                onClick={selectAllServices}
                className={`rounded-full border px-3 py-1 text-xs font-display transition-colors ${
                  allServicesSelected
                    ? 'border-ink/10 bg-ink/10 text-ink-muted'
                    : 'border-ink/10 bg-white text-ink-muted hover:border-primary/30'
                }`}
              >
                เลือกทั้งหมด
              </button>
              <button type="button" onClick={clearSelectedServices} className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-display text-ink-muted">
                ยกเลิกทั้งหมด
              </button>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {services.map((s) => {
              const isSelected = selectedServiceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleServiceSelection(s.id)}
                  className={`px-4 py-2 rounded-full text-sm font-display font-medium transition-colors ${
                    isSelected
                      ? 'bg-primary text-white'
                      : 'bg-surface text-ink-muted border border-ink/10 hover:border-primary/30'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        <section className="bg-surface rounded-2xl p-5 shadow-sm mb-6">
          <h2 className="font-display font-medium text-primary mb-3">Dashboard คิวตามส่วนงาน</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            {callingSummary.length === 0 ? (
              <p className="text-sm text-ink-muted">ยังไม่มีข้อมูลคิวที่กำลังเรียก</p>
            ) : (
              callingSummary.map(({ counterNo, ticketNo, serviceName }) => (
                <div
                  key={`summary-${counterNo}`}
                  className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-display"
                >
                  <span className="font-semibold text-primary">ช่อง {counterNo}</span>
                  <span className="mx-2 text-ink-muted">:</span>
                  <span className="text-ink">{ticketNo}</span>
                  <span className="ml-2 text-ink-muted">({serviceName})</span>
                </div>
              ))
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {dashboard.length === 0 ? (
              <p className="text-sm text-ink-muted">ยังไม่มีข้อมูลคิวสำหรับส่วนงาน</p>
            ) : (
              dashboard.map((item) => (
                <button type="button" key={item.id} onClick={() => openReport(item)} className="w-full text-left rounded-xl border border-ink/10 bg-white p-3 hover:border-primary/40 hover:shadow-sm transition-shadow">
                  <p className="font-display font-medium text-primary">{item.name}</p>
                  <div className="mt-2 text-sm text-ink">
                    <p>รอ: {item.waiting}</p>
                    <p>กำลังเรียก: {item.calling}</p>
                    <p>ข้าม: {item.skipped}</p>
                    <p>รวมวันนี้: {item.total}</p>
                    <p className="mt-1 border-t border-ink/10 pt-1">Walk-in: {item.walkIn} · Booking: {item.booking}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="bg-surface rounded-2xl p-5 shadow-sm mb-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 className="font-display font-medium text-primary">ผู้จองตามวันที่เข้ารับบริการ</h2>
              <p className="text-xs text-ink-muted">ตรวจสอบว่าใครจองคิวของวันไหน</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="date" value={bookingDate} onChange={(e) => { setBookingDate(e.target.value); setShowAllBookings(false); }} className="rounded-lg border border-ink/15 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setShowAllBookings((value) => !value)} className={`rounded-lg border px-3 py-2 text-sm ${showAllBookings ? 'border-primary bg-primary text-white' : 'border-primary text-primary'}`}>
                {showAllBookings ? 'ดูวันที่เลือก' : 'ทั้งหมด'}
              </button>
            </div>
          </div>
          {sortedBookings.length === 0 ? (
            <p className="text-sm text-ink-muted">{showAllBookings ? 'ยังไม่มีรายการจอง' : `ยังไม่มีรายการจองสำหรับวันที่ ${bookingDate}`}</p>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-ink/10"><th className="p-2">คิว</th><th className="p-2">ผู้จอง</th><th className="p-2">เบอร์โทรศัพท์</th><th className="p-2">บริการ</th><th className="p-2">ช่วงเวลา</th><th className="p-2">เวลาที่จอง</th><th className="p-2">สถานะ</th></tr></thead>
                <tbody>
                  {sortedBookings.slice(0, 5).map((item) => (
                    <tr key={item.id} className="border-b border-ink/10">
                      <td className="p-2 font-semibold text-primary">{item.ticketNo}</td>
                      <td className="p-2">{item.userName}</td>
                      <td className="p-2">{item.userPhone}</td>
                      <td className="p-2">{item.service?.name || '-'}</td>
                      <td className="p-2">{item.timeSlot ? `${item.timeSlot.startTime} - ${item.timeSlot.endTime}` : '-'}</td>
                      <td className="p-2 whitespace-nowrap">{formatBookingTime(item.createdAt)}</td>
                      <td className="p-2"><span className={bookingStatusClass(item)}>{bookingStatusLabel(item)}</span>{item.status === 'SKIPPED' && <div className="mt-1 flex gap-2"><button type="button" onClick={() => handleBookingAction(reinsertQueue, item.id)} disabled={busy} className="text-xs text-primary underline">ดึงกลับ</button><button type="button" onClick={() => handleBookingAction(cancelQueue, item.id)} disabled={busy} className="text-xs text-danger underline">ยกเลิก</button></div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-muted">แสดง {Math.min(sortedBookings.length, 5)} จาก {sortedBookings.length} รายการ</p>
              <div className="flex gap-2">
                {sortedBookings.length > 5 && <button type="button" onClick={() => setBookingModalOpen(true)} className="rounded-lg border border-primary px-3 py-2 text-sm text-primary">แสดงทั้งหมด</button>}
                <button type="button" onClick={exportBookings} className="rounded-lg bg-success px-3 py-2 text-sm text-white">ส่งออก Excel</button>
              </div>
            </div>
            </>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main column: counter control + waiting list */}
          <div className="lg:col-span-2 space-y-6">
            <section className="ticket-stub bg-surface p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-medium text-primary">ช่องบริการที่กำลังทำงาน</h2>
                <select
                  value={counterNo}
                  onChange={(e) => setCounterNo(Number(e.target.value))}
                  className="border border-ink/15 rounded-lg text-sm px-3 py-1.5"
                >
                  {counters.length > 0 ? (
                    counters.map((counter) => (
                      <option key={counter.id} value={parseCounterNumber(counter)}>
                        {counter.name || `ช่องบริการ ${counter.id}`} ({parseCounterNumber(counter)})
                      </option>
                    ))
                  ) : (
                    <option value="1">ยังไม่มีช่องบริการในฐานข้อมูล</option>
                  )}
                </select>
              </div>

              {!selectedCounterQueue && (
                <p className="text-ink-muted text-sm mb-4">ยังไม่มีคิวที่กำลังเรียกสำหรับช่อง {counterNo}</p>
              )}

              {selectedCounterQueue && (
                <div className="space-y-3 mb-4">
                  <div className="rounded-xl border border-primary/15 bg-primary/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-display font-semibold tracking-wide text-primary">
                        ช่องบริการ {counterNo}
                      </span>
                      <span className="text-[10px] text-ink-muted">
                        {selectedCounterQueue.service?.name || services.find((service) => service.id === selectedCounterQueue.serviceId)?.name || 'บริการ'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between bg-white border border-primary/20 rounded-xl px-3 py-3">
                      <div>
                        <p className="font-display font-semibold text-2xl text-primary">
                          {selectedCounterQueue.ticketNo}
                        </p>
                        <p className="text-xs text-ink-muted">{selectedCounterQueue.userName}</p>
                      </div>
                      <div className="flex gap-2">
                        <ActionButton onClick={() => handleRecall(selectedCounterQueue.id)} disabled={busy}>
                          เรียกซ้ำ
                        </ActionButton>
                        <ActionButton onClick={() => handleComplete(selectedCounterQueue.id)} disabled={busy} tone="success">
                          เสร็จสิ้น
                        </ActionButton>
                        <ActionButton onClick={() => handleSkip(selectedCounterQueue.id)} disabled={busy} tone="warning">
                          ข้ามคิว
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleNext}
                disabled={busy || waiting.length === 0 || Boolean(selectedCounterQueue)}
                className="w-full bg-primary hover:bg-primary-light disabled:opacity-50 text-white font-display font-medium rounded-xl py-3 transition-colors"
              >
                เรียกคิวถัดไป (Next)
              </button>
            </section>

            <section className="bg-surface rounded-2xl p-6 shadow-sm">
              <h2 className="font-display font-medium text-primary mb-4">
                คิวที่กำลังรอ ({waiting.length})
              </h2>
              <div className="space-y-3">
                {waitingByService.length === 0 && (
                  <p className="text-ink-muted text-sm">ไม่มีคิวที่รออยู่ในขณะนี้</p>
                )}
                {waitingByService.map(({ serviceId, serviceName, items }) => (
                  <div key={serviceId} className="rounded-xl border border-ink/10 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-display font-semibold tracking-wide text-primary">
                        {serviceName}
                      </span>
                      <span className="text-[10px] text-ink-muted">{items.length} คิว</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((q, idx) => (
                        <button
                          type="button"
                          key={q.id}
                          onClick={() => setQueueToCall(q)}
                          className={`flex w-full items-center justify-between border rounded-xl px-3 py-2 text-left transition-colors hover:border-warning/40 hover:bg-warning/5 ${isBookingDelayed(q) ? 'border-warning/30 bg-warning/5' : 'border-ink/10'}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-ink-muted w-5">{idx + 1}</span>
                            <span className="font-display font-medium text-ink">{q.ticketNo}</span>
                            {isBookingDelayed(q) && (
                              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-medium text-warning">Delayed / เกินรอบนัด</span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-ink-muted">{q.userName}</div>
                            <div className="text-[10px] text-ink-muted">{q.queueType === 'BOOKING' ? 'Booking' : 'Walk-in'} · {formatWaitDuration(q)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Side column: queue statuses */}
          <aside className="bg-surface rounded-2xl p-6 shadow-sm h-fit">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display font-medium text-primary">
                สถานะ ({statusQueues.length})
              </h2>
              <button
                type="button"
                onClick={() => setRestoreCancelledModalOpen(true)}
                className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-display font-medium text-danger transition-colors hover:bg-danger/20"
              >
                ดึงคืนคิวยกเลิก{cancelledQueues.length > 0 ? ` (${cancelledQueues.length})` : ''}
              </button>
            </div>
            <div className="space-y-2">
              {statusQueues.length === 0 && (
                <p className="text-ink-muted text-sm">ยังไม่มีรายการเสร็จสิ้น ยกเลิก หรือข้ามคิว</p>
              )}
              {statusQueues.map((q) => {
                const status = {
                  SKIPPED: { label: 'ข้ามคิว', className: 'bg-warning/10 text-warning' },
                  COMPLETED: { label: 'เสร็จสิ้น', className: 'bg-success/10 text-success' },
                  CANCELLED: { label: 'ยกเลิก', className: 'bg-danger/10 text-danger' },
                }[q.status];

                return (
                <div
                  key={q.id}
                  className="flex items-center justify-between border border-ink/10 bg-white rounded-xl px-4 py-2.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-display font-medium text-ink text-sm">{q.ticketNo}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-display font-medium ${status.className}`}>
                        {isExpiredBooking(q) ? 'Booking เลยเวลาจอง' : status.label}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted">{q.userName}</p>
                  </div>
                  {q.status === 'SKIPPED' && (
                    <div className="flex gap-2">
                      <ActionButton onClick={() => handleReinsert(q.id)} disabled={busy} tone="warning">ดึงเรียกคืน</ActionButton>
                      <ActionButton onClick={() => handleCancel(q.id)} disabled={busy} tone="danger">ยกเลิก</ActionButton>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>

      {queueToCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal="true" aria-labelledby="call-queue-title">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 id="call-queue-title" className="font-display text-lg font-medium text-ink">ยืนยันเรียกคิว</h3>
            <p className="mt-2 text-sm text-ink-muted">
              ต้องการเรียกคิว <span className="font-display font-medium text-ink">{queueToCall.ticketNo}</span> โดยข้ามคิวที่อยู่ก่อนหน้า ใช่หรือไม่?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQueueToCall(null)}
                disabled={busy}
                className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-ink/5 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmCallWaitingQueue}
                disabled={busy}
                className="rounded-lg bg-warning px-3 py-2 text-sm font-display font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
              >
                ยืนยันเรียกคิว
              </button>
            </div>
          </div>
        </div>
      )}
      {restoreCancelledModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal="true" aria-labelledby="restore-cancelled-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 id="restore-cancelled-title" className="font-display text-lg font-medium text-ink">ดึงคิวที่ยกเลิกกลับ</h3>
            <p className="mt-2 text-sm text-ink-muted">เลือกคิวที่ต้องการนำกลับมาเป็นคิวรอ สำหรับช่องบริการ {counterNo}</p>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {cancelledQueues.length === 0 ? (
                <p className="rounded-lg bg-ink/5 px-3 py-4 text-center text-sm text-ink-muted">ไม่มีคิวที่ถูกยกเลิก</p>
              ) : (
                cancelledQueues.map((queue) => (
                  <div key={queue.id} className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-display font-medium text-primary">{queue.ticketNo}</p>
                        {queue.bookingExpired && (
                          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-display font-medium text-warning">
                            Booking หมดอายุ
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted">{queue.userName} · {queue.service?.name || 'บริการ'}</p>
                    </div>
                    <ActionButton onClick={() => handleRestoreCancelled(queue.id)} disabled={busy} tone="warning">
                      ดึงคืน
                    </ActionButton>
                  </div>
                ))
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setRestoreCancelledModalOpen(false)}
                disabled={busy}
                className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-ink/5 disabled:opacity-50"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ children, tone = 'default', ...props }) {
  const toneClasses = {
    default: 'bg-ink/5 text-ink hover:bg-ink/10',
    success: 'bg-success/10 text-success hover:bg-success/20',
    warning: 'bg-warning/10 text-warning hover:bg-warning/20',
    danger: 'bg-danger/10 text-danger hover:bg-danger/20',
  }[tone];

  return (
    <button
      {...props}
      className={`text-xs font-display font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${toneClasses}`}
    >
      {children}
    </button>
  );
}
