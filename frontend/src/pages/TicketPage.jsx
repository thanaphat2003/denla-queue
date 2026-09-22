import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { getQueue, checkInQueue } from '../api.js';
import socket from '../socket.js';
import Logo from '../components/Logo.jsx';

const STATUS_LABEL = {
  WAITING: { text: 'กำลังรอคิว', color: 'text-ink-muted' },
  CALLING: { text: 'ถึงคิวของท่านแล้ว!', color: 'text-success' },
  COMPLETED: { text: 'ดำเนินการเสร็จสิ้น', color: 'text-ink-muted' },
  SKIPPED: { text: 'คิวถูกข้าม กรุณาติดต่อเจ้าหน้าที่', color: 'text-warning' },
  CANCELLED: { text: 'คิวถูกยกเลิก', color: 'text-danger' },
};

const formatBookingDate = (value, isEnglish) => {
  if (!value) return '';
  const rawValue = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
    ? new Date(`${rawValue}T00:00:00`)
    : new Date(value);
  return new Intl.DateTimeFormat(isEnglish ? 'en-US' : 'th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const formatDateTime = (value, isEnglish) => {
  if (!value) return '';
  return new Intl.DateTimeFormat(isEnglish ? 'en-US' : 'th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

export default function TicketPage() {
  const { id } = useParams();
  const [queue, setQueue] = useState(null);
  const [waitingAhead, setWaitingAhead] = useState(null);
  const [error, setError] = useState('');
  const [checkInError, setCheckInError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const isEnglish = localStorage.getItem('queue-language') === 'EN';
  const text = (th, en) => (isEnglish ? en : th);

  useEffect(() => {
    let serviceIdForRoom = null;

    getQueue(id)
      .then((data) => {
        setQueue(data);
        setWaitingAhead(data.waitingAhead);
        serviceIdForRoom = data.serviceId;
        socket.emit('subscribe:service', data.serviceId);
        socket.emit('subscribe:track', Number(id));
      })
      .catch(() => setError('ไม่พบข้อมูลคิวนี้'));

    const onBoard = (queues) => {
      const mine = queues.find((q) => q.id === Number(id));
      if (!mine) return;
      setQueue((prev) => ({ ...prev, ...mine }));
      const ahead = queues.filter(
        (q) => q.status === 'WAITING' && q.id < mine.id
      ).length;
      setWaitingAhead(mine.status === 'WAITING' ? ahead : 0);
    };

    // อัปเดตสถานะคิวทันทีเมื่อ admin ดึงคืนคิวที่เกินเวลา / ยกเลิก / ข้ามคิว
    const onQueueUpdated = (updated) => {
      if (updated.id !== Number(id)) return;
      setQueue((prev) => ({ ...prev, ...updated }));
      if (updated.status !== 'WAITING') setWaitingAhead(0);
    };

    // เมื่อถึงคิว (admin เรียกคิว)
    const onQueueCalled = (called) => {
      if (called.id !== Number(id)) return;
      setQueue((prev) => ({ ...prev, ...called }));
      setWaitingAhead(0);
    };

    socket.on('queue:board', onBoard);
    socket.on('queue:updated', onQueueUpdated);
    socket.on('queue:reinserted', onQueueUpdated);
    socket.on('queue:called', onQueueCalled);
    socket.on('queue:skipped', onQueueUpdated);

    return () => {
      socket.off('queue:board', onBoard);
      socket.off('queue:updated', onQueueUpdated);
      socket.off('queue:reinserted', onQueueUpdated);
      socket.off('queue:called', onQueueCalled);
      socket.off('queue:skipped', onQueueUpdated);
    };
  }, [id]);

  if (error) {
    return <CenterMessage text={error} />;
  }
  if (!queue) {
    return <CenterMessage text="กำลังโหลดข้อมูลคิว..." />;
  }

  const isBookingTicket = queue.queueType === 'BOOKING';
  const isBookingExpired = isBookingTicket && queue.status === 'SKIPPED' && queue.timeSlot?.endTime && queue.bookingDate
    && new Date() > (() => { const raw = String(queue.bookingDate); const end = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw); const [hours, minutes] = queue.timeSlot.endTime.split(':').map(Number); end.setHours(hours || 0, minutes || 0, 0, 0); return end; })();

  // คิว Booking ที่เลยเวลาแล้ว แต่ admin ดึงคืนกลับมา (isCheckedIn=true ถูก set โดย backend เพื่อป้องกัน re-expire)
  const isAdminRestored = isBookingTicket && queue.status === 'WAITING' && queue.isCheckedIn && queue.timeSlot?.endTime && queue.bookingDate
    && new Date() > (() => { const raw = String(queue.bookingDate); const end = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw); const [hours, minutes] = queue.timeSlot.endTime.split(':').map(Number); end.setHours(hours || 0, minutes || 0, 0, 0); return end; })();

  const trackUrl = typeof window !== 'undefined' ? window.location.href : '';

  const bookingDateText = formatBookingDate(queue.bookingDate, isEnglish);
  const bookingTimeText = queue.timeSlot?.startTime && queue.timeSlot?.endTime
    ? `${queue.timeSlot.startTime} - ${queue.timeSlot.endTime}`
    : queue.timeSlot?.startTime || '';
  const bookingWindowOpen = (() => {
    if (!isBookingTicket || !queue.timeSlot?.startTime) return true;
    const [hours, minutes] = queue.timeSlot.startTime.split(':').map(Number);
    const raw = String(queue.bookingDate || '');
    const bookingDate = raw ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw) : new Date();
    bookingDate.setHours(hours, minutes, 0, 0);
    const now = new Date();
    return now >= new Date(bookingDate.getTime() - 15 * 60 * 1000);
  })();

  // Check-in แล้ว แต่ยังไม่ถึงรอบเวลา (slot startTime ยังไม่ถึง)
  const isCheckedInBeforeSlot = isBookingTicket && queue.isCheckedIn && queue.status === 'WAITING'
    && queue.timeSlot?.startTime && queue.bookingDate && (() => {
      const [h, m] = queue.timeSlot.startTime.split(':').map(Number);
      const raw = String(queue.bookingDate);
      const slotStart = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
      slotStart.setHours(h, m, 0, 0);
      return new Date() < slotStart;
    })() && !isAdminRestored;

  const isBeforeCheckInWindow = isBookingTicket && !queue.isCheckedIn && !bookingWindowOpen;
  const status = isBookingExpired
    ? { text: text('Booking เลยเวลาจอง กรุณาติดต่อเจ้าหน้าที่', 'Booking time expired. Please contact staff.'), color: 'text-warning' }
    : isAdminRestored
      ? { text: text('คิวถูกเปิดใช้งานอีกครั้งโดยเจ้าหน้าที่ กำลังรอคิว', 'Queue reactivated by staff. Waiting for your turn.'), color: 'text-primary' }
      : isCheckedInBeforeSlot
        ? { text: text(`Check-in แล้ว กำลังรอรอบเวลา ${queue.timeSlot?.startTime} น.`, `Checked in. Waiting for your time slot at ${queue.timeSlot?.startTime}`), color: 'text-primary' }
        : isBeforeCheckInWindow
          ? { text: text('ยังไม่ถึงเวลา Check-in', 'Check-in is not open yet'), color: 'text-ink-muted' }
          : isEnglish ? {
            WAITING: { text: 'Waiting for your turn', color: 'text-ink-muted' }, CALLING: { text: 'It is your turn!', color: 'text-success' }, COMPLETED: { text: 'Completed', color: 'text-ink-muted' }, SKIPPED: { text: 'Skipped, please contact staff', color: 'text-warning' }, CANCELLED: { text: 'Cancelled', color: 'text-danger' },
          }[queue.status] || STATUS_LABEL.WAITING : STATUS_LABEL[queue.status] || STATUS_LABEL.WAITING;


  const handleCheckIn = async () => {
    try {
      setCheckInError('');
      setCheckingIn(true);
      const updated = await checkInQueue(queue.id);
      setQueue((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      setCheckInError(err?.response?.data?.error || 'เช็กอินไม่สำเร็จ');
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas font-body flex flex-col">
      <header className="bg-surface border-b border-primary/10">
        <div className="max-w-md mx-auto px-5 py-4">
          <Logo page="booking" />
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-5 py-10 flex flex-col items-center">
        <div
          className="ticket-stub w-full shadow-lg overflow-hidden"
          style={{ '--ticket-notch-bg': '#F5F6F8' }}
        >
          <div className="bg-primary text-white text-center py-5">
            <p className="text-xs tracking-widest opacity-80 font-display">YOUR QUEUE NUMBER</p>
            <p className="font-display font-semibold text-6xl mt-1">{queue.ticketNo}</p>
          </div>

          <div
            className="border-t-2 border-dashed border-primary/15 mx-6"
            style={{ marginTop: -1 }}
          />

          <div className="p-6 text-center space-y-4">
            <p className={`font-display font-medium ${status.color}`}>{status.text}</p>

            {checkInError && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-3 text-left text-sm text-warning">
                {checkInError}
              </div>
            )}

            {isBookingTicket && queue.bookingDate && !queue.isCheckedIn && !bookingWindowOpen && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-left text-xs text-warning">
                {text('ยังไม่ถึงเวลาชำระเช็กอิน กรุณาเข้ามาเช็กอินได้ภายใน 15 นาทีก่อนเริ่มคิว', 'Check-in is not available yet. Please check in within 15 minutes before the scheduled time.')}
              </div>
            )}

            {isAdminRestored ? (
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-left text-xs text-primary">
                {text(
                  'เจ้าหน้าที่ได้ดึงคิวของท่านกลับมาใช้งานแล้ว กรุณารอเรียกคิวตามลำดับ',
                  'Staff has reactivated your queue. Please wait to be called.'
                )}
              </div>
            ) : (
              isBookingTicket && queue.isCheckedIn && queue.status === 'WAITING' && (
                <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                  {text('เช็กอินเรียบร้อย', 'Checked in successfully')}
                </div>
              )
            )}

            {isBookingTicket && queue.status === 'WAITING' && queue.bookingDate && (
              <p className="text-ink text-sm">
                {text('มีคิวรออยู่ก่อนหน้าท่านอีก', 'There are')} {' '}
                <span className="font-display font-semibold text-primary text-lg">
                  {waitingAhead ?? '-'}
                </span>{' '}
                {text('คิว', 'queues')}
              </p>
            )}

            {queue.status === 'WAITING' && !isBookingTicket && (
              <p className="text-ink text-sm">
                มีคิวรออยู่ก่อนหน้าท่านอีก{' '}
                <span className="font-display font-semibold text-primary text-lg">
                  {waitingAhead ?? '-'}
                </span>{' '}
                คิว
              </p>
            )}

            {isBookingTicket && !queue.isCheckedIn && bookingWindowOpen && (
              <button
                type="button"
                onClick={handleCheckIn}
                disabled={checkingIn}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-70"
              >
                {checkingIn ? text('กำลังเช็กอิน...', 'Checking in...') : text('ฉันมาถึงแล้ว / Check-in', 'I have arrived / Check-in')}
              </button>
            )}

            <div className="flex justify-center py-2">
              <QRCodeSVG value={trackUrl} size={128} fgColor="#1F3864" />
            </div>

            <div className="text-left text-sm text-ink-muted border-t border-ink/10 pt-4 space-y-1">
              <p>
                {text('บริการ', 'Service')}: <span className="text-ink">{isEnglish ? queue.service?.nameEn || queue.service?.name : queue.service?.name}</span>
              </p>
              {queue.contactSubject && (
                <p>
                  {text('เรื่องที่มาติดต่อ', 'Reason for visit')}: <span className="text-ink">{isEnglish ? queue.contactSubjectEn || queue.contactSubject : queue.contactSubject}</span>
                </p>
              )}
              <p>
                {text('ชื่อผู้จอง', 'Booked by')}: <span className="text-ink">{queue.userName}</span>
              </p>
              {isBookingTicket && bookingDateText && (
                <>
                  <p>
                    {text('เวลาที่จอง', 'Booked at')}: <span className="text-ink">{formatDateTime(queue.createdAt, isEnglish)}</span>
                  </p>
                  <p>
                    {text('วันที่เข้ารับบริการ', 'Service date')}: <span className="text-ink">{bookingDateText}</span>
                  </p>
                  {bookingTimeText && (
                    <p>
                      {text('เวลานัดหมาย', 'Appointment time')}: <span className="text-ink">{bookingTimeText}</span>
                    </p>
                  )}
                </>
              )}
              {queue.status === 'COMPLETED' && queue.completedAt && (
                <p>
                  {text('เวลาสิ้นสุด', 'Completed at')}: <span className="text-ink">{formatDateTime(queue.completedAt, isEnglish)}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-ink-muted mt-6 text-center">
          หน้านี้จะอัปเดตสถานะโดยอัตโนมัติ ท่านสามารถปิดหน้านี้ได้และกลับมาดูใหม่ผ่าน QR Code
          ด้านบน หรือระบบจะส่งอีเมลแจ้งเตือนเมื่อใกล้ถึงคิวของท่าน
        </p>
      </main>
    </div>
  );
}

function CenterMessage({ text }) {
  return (
    <div className="min-h-screen flex items-center justify-center font-body text-ink-muted">
      {text}
    </div>
  );
}
