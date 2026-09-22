import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getServices, getContactSubjects, createQueue, getAvailableTimeSlots, getActiveAnnouncements } from '../api.js';
import Logo from '../components/Logo.jsx';

export default function BookingPage() {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [contactSubjects, setContactSubjects] = useState([]);
  const [serviceId, setServiceId] = useState(null);
  const [bookingMode, setBookingMode] = useState('WALK_IN');
  const [bookingDate, setBookingDate] = useState('');
  const [timeSlots, setTimeSlots] = useState([]);
  const [timeSlotId, setTimeSlotId] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [form, setForm] = useState({
    contactSubject: '',
    userName: '',
    userPhone: '',
    userEmail: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState(() => localStorage.getItem('queue-language') || 'TH');

  // Announcement popup
  const [announcements, setAnnouncements] = useState([]);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcementIndex, setAnnouncementIndex] = useState(0);

  const isEnglish = language === 'EN';
  const text = (th, en) => (isEnglish ? en : th);
  const serviceName = (service) => (isEnglish ? service.nameEn || service.name : service.name);
  const subjectName = (subject) => (isEnglish ? subject.nameEn || subject.name : subject.name);
  const todayDate = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };
  const getAnnouncementKey = (item) => String(item.id ?? `${item.title}|${item.startDate || ''}|${item.endDate || ''}`);
  const getShownAnnouncementIds = () => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('school-queue-shown-announcements') || '[]');
      return new Set(Array.isArray(stored) ? stored : []);
    } catch {
      return new Set();
    }
  };
  const setAnnouncementPopup = (items, mode, targetDate) => {
    const list = Array.isArray(items) ? items : [];
    const shouldSuppressShownToday = targetDate === todayDate();
    const shownIds = getShownAnnouncementIds();
    const visibleAnnouncements = shouldSuppressShownToday
      ? list.filter((item) => !shownIds.has(getAnnouncementKey(item)))
      : list;

    if (visibleAnnouncements.length > 0) {
      visibleAnnouncements.forEach((item) => shownIds.add(getAnnouncementKey(item)));
      sessionStorage.setItem('school-queue-shown-announcements', JSON.stringify(Array.from(shownIds)));
    }
    setAnnouncements(visibleAnnouncements);
    setAnnouncementIndex(0);
    setAnnouncementOpen(visibleAnnouncements.length > 0);
  };

  useEffect(() => {
    let isMounted = true;

    sessionStorage.removeItem('school-queue-shown-announcements');
    setLoading(true);
    Promise.all([getServices(), getActiveAnnouncements(todayDate())])
      .then(([list, ann]) => {
        if (!isMounted) return;
        setServices(Array.isArray(list) ? list : []);
        setError('');
        setAnnouncementPopup(ann, 'WALK_IN', todayDate());
      })
      .catch(() => {
        if (!isMounted) return;
        setServices([]);
        setContactSubjects([]);
        setError('ไม่สามารถโหลดประเภทบริการได้ กรุณาลองใหม่');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!serviceId) {
      setContactSubjects([]);
      setForm((prev) => ({ ...prev, contactSubject: '' }));
      return;
    }
    getContactSubjects(serviceId).then((subjects) => setContactSubjects(Array.isArray(subjects) ? subjects : [])).catch(() => setContactSubjects([]));
  }, [serviceId]);

  useEffect(() => {
    if (!bookingDate) {
      setTimeSlots([]);
      setTimeSlotId(null);
      return;
    }
    setLoadingSlots(true);
    getAvailableTimeSlots(bookingDate)
      .then(slots => setTimeSlots(slots || []))
      .catch(() => setTimeSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [bookingDate]);

  useEffect(() => {
    const targetDate = bookingMode === 'BOOKING' && bookingDate ? bookingDate : todayDate();
    if (!bookingDate) {
      if (bookingMode === 'BOOKING') {
        setAnnouncementPopup(announcements, bookingMode, targetDate);
      }
      return;
    }
    getActiveAnnouncements(targetDate).then((ann) => {
      setAnnouncementPopup(ann, bookingMode, targetDate);
    });
  }, [bookingDate, bookingMode]);

  useEffect(() => {
    localStorage.setItem('queue-language', language);
  }, [language]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const handleChange = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const isBookingMode = bookingMode === 'BOOKING';

  const isSlotStarted = (slot) => {
    if (!bookingDate || !slot?.startTime) return false;
    const selectedDate = new Date(`${bookingDate}T00:00:00`);
    const todayStart = new Date(currentTime);
    todayStart.setHours(0, 0, 0, 0);
    if (todayStart > selectedDate) return true;
    if (todayStart < selectedDate) return false;

    const [hours, minutes] = slot.startTime.split(':').map(Number);
    const slotStart = new Date(currentTime);
    slotStart.setHours(hours, minutes, 0, 0);
    return currentTime >= slotStart;
  };

  const groupedSlots = timeSlots.reduce((groups, slot) => {
    const range = Number(slot.startTime?.split(':')?.[0] ?? 0);
    const bucket = range < 12 ? 'Morning' : 'Afternoon';
    groups[bucket].push(slot);
    return groups;
  }, { Morning: [], Afternoon: [] });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!serviceId) return setError('กรุณาเลือกประเภทบริการ');
    if (isBookingMode) {
      if (!bookingDate) return setError('กรุณาเลือกวันที่เข้ารับบริการ');
      if (!timeSlotId) return setError('กรุณาเลือกช่วงเวลาที่ต้องการ');
      const selectedSlot = timeSlots.find((slot) => slot.id === timeSlotId);
      if (selectedSlot && isSlotStarted(selectedSlot)) {
        setTimeSlotId(null);
        return setError('ช่วงเวลานี้เริ่มให้บริการแล้ว ไม่สามารถจองได้');
      }
    }
    if (!form.contactSubject) return setError('กรุณาเลือกเรื่องที่มาติดต่อ');
    if (!form.userName || !form.userPhone || !form.userEmail) {
      return setError('กรุณากรอกข้อมูลให้ครบถ้วน');
    }
    setSubmitting(true);
    try {
      const selectedSubject = contactSubjects.find((subject) => subject.name === form.contactSubject);
      const queue = await createQueue({
        serviceId,
        ...form,
        language,
        queueType: bookingMode,
        contactSubjectEn: selectedSubject?.nameEn || selectedSubject?.name || '',
        ...(isBookingMode ? { bookingDate, timeSlotId } : {}),
      });
      navigate(`/track/${queue.id}`);
    } catch (err) {
      setError(err?.response?.data?.error || 'จองคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas font-body">
      {/* ── Announcement Popup ── */}
      {announcementOpen && announcements[announcementIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-surface w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
            {/* Header bar */}
            <div className="bg-primary px-6 py-4 flex items-center gap-3">
              <span className="text-2xl">📢</span>
              <h2 className="font-display font-semibold text-white text-lg leading-tight flex-1">
                {announcements[announcementIndex].title}
              </h2>
              {announcements.length > 1 && (
                <span className="text-white/70 text-xs font-mono">
                  {announcementIndex + 1}/{announcements.length}
                </span>
              )}
            </div>
            {/* Body */}
            <div className="px-6 py-5">
              <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
                {announcements[announcementIndex].body}
              </p>
              {(announcements[announcementIndex].startDate || announcements[announcementIndex].endDate) && (
                <p className="mt-3 text-xs text-ink-muted border-t border-ink/10 pt-3">
                  {announcements[announcementIndex].startDate && (
                    <span>เริ่ม: {new Date(announcements[announcementIndex].startDate).toLocaleDateString('th-TH', { dateStyle: 'long' })}  </span>
                  )}
                  {announcements[announcementIndex].endDate && (
                    <span>ถึง: {new Date(announcements[announcementIndex].endDate).toLocaleDateString('th-TH', { dateStyle: 'long' })}</span>
                  )}
                </p>
              )}
            </div>
            {/* Footer */}
            <div className="px-6 pb-5 flex justify-end gap-2">
              {announcementIndex < announcements.length - 1 && (
                <button
                  type="button"
                  onClick={() => setAnnouncementIndex((i) => i + 1)}
                  className="px-5 py-2 rounded-xl border border-primary text-primary text-sm font-medium hover:bg-primary/5 transition-colors"
                >
                  {text('ถัดไป', 'Next')} ({announcementIndex + 2}/{announcements.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setAnnouncementOpen(false)}
                className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-light transition-colors"
              >
                {text('รับทราบ / ปิด', 'Acknowledge & Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-surface border-b border-primary/10">
        <div className="max-w-2xl mx-auto px-5 py-4">
          <div className="flex items-center justify-between gap-3"><Logo page="booking" /><LanguageSwitch language={language} onChange={setLanguage} /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-10">
        <div className="mb-8">
          <p className="text-accent font-display font-semibold tracking-widest text-xs mb-2">
            {text('จองคิว', 'QUEUE BOOKING')}
          </p>
          <h1 className="font-display font-semibold text-3xl text-primary mb-2">
            {text('จองคิวติดต่อธุรการ', 'Administrative Queue Booking')}
          </h1>
          <p className="text-ink-muted text-sm">
            {text('เลือกบริการที่ต้องการ กรอกข้อมูล แล้วรับหมายเลขคิวพร้อมลิงก์ติดตามสถานะแบบเรียลไทม์', 'Choose a service, enter your details, and receive a queue number with real-time tracking.')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <section>
            <h2 className="font-display font-medium text-primary mb-3 text-sm">
              1. {text('เลือกประเภทบริการ', 'Choose a service category')}
            </h2>
            {loading && <p className="text-sm text-ink-muted">{text('กำลังโหลดประเภทบริการจากฐานข้อมูล...', 'Loading service categories...')}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {services.map((s) => {
                const active = serviceId === s.id;
                const isImageIcon = /^https?:\/\//i.test(s.icon || '') || /^data:/i.test(s.icon || '');

                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setServiceId(s.id)}
                    className={`text-left rounded-2xl border-2 p-4 transition-all ${
                      active
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-ink/10 bg-surface hover:border-primary/30'
                    }`}
                  >
                    {isImageIcon ? (
                      <img
                        src={s.icon}
                        alt={s.name}
                        className="h-12 w-12 rounded-xl object-cover border border-ink/10 bg-white"
                        style={{ objectFit: 'cover' }}
                      />
                    ) : (
                      <span className="text-2xl block h-12 w-12 flex items-center justify-center">{s.icon || '🏫'}</span>
                    )}
                    <p className="font-display font-medium text-ink mt-2 text-sm">{serviceName(s)}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{s.descriptionEn || s.description ? (isEnglish ? s.descriptionEn || s.description : s.description || s.descriptionEn) : text(`คิว ${s.prefix}`, `Queue ${s.prefix}`)}</p>
                  </button>
                );
              })}
            </div>
          </section>

          
          <section>
            <h2 className="font-display font-medium text-primary mb-3 text-sm">
              2. {text('เลือกประเภทการเข้ารับบริการ', 'Select service mode')}
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                type="button"
                onClick={() => setBookingMode('WALK_IN')}
                className={`rounded-xl border px-4 py-3 text-sm font-medium ${bookingMode === 'WALK_IN' ? 'border-primary bg-primary/5 text-primary' : 'border-ink/15 bg-surface text-ink'}`}
              >
                {text('รับบริการทันที', 'Walk-in')}
              </button>
              <button
                type="button"
                onClick={() => setBookingMode('BOOKING')}
                className={`rounded-xl border px-4 py-3 text-sm font-medium ${bookingMode === 'BOOKING' ? 'border-primary bg-primary/5 text-primary' : 'border-ink/15 bg-surface text-ink'}`}
              >
                {text('จองคิวล่วงหน้า', 'Book in advance')}
              </button>
            </div>

            {isBookingMode && (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-xs text-ink-muted mb-1 block">{text('วันที่ (Date)', 'Date')}</span>
                  <input
                    type="date"
                    value={bookingDate}
                    min={todayDate()}
                    onChange={e => { setBookingDate(e.target.value); setTimeSlotId(null); }}
                    className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                  />
                </label>

                {bookingDate && (
                  <div>
                    <span className="text-xs text-ink-muted mb-2 block">{text('ช่วงเวลาที่ว่าง (Available Time Slots)', 'Available Time Slots')}</span>
                    {loadingSlots ? (
                      <p className="text-sm text-ink-muted">{text('กำลังโหลด...', 'Loading...')}</p>
                    ) : timeSlots.length > 0 ? (
                      <div className="space-y-4">
                        {['Morning', 'Afternoon'].map((period) => {
                          const slots = groupedSlots[period];
                          if (!slots.length) return null;

                          return (
                            <div key={period}>
                              <p className="text-xs font-medium text-ink-muted mb-2">{period === 'Morning' ? text('ช่วงเช้า', 'Morning') : text('ช่วงบ่าย', 'Afternoon')}</p>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {slots.map(slot => {
                                  const isDisabled = slot.isFull || isSlotStarted(slot);
                                  return (
                                    <button
                                      key={slot.id}
                                      type="button"
                                      disabled={isDisabled}
                                      onClick={() => setTimeSlotId(slot.id)}
                                      className={`rounded-xl border p-3 text-sm text-center transition-all ${isDisabled ? 'bg-ink/5 border-ink/10 text-ink/40 cursor-not-allowed' : timeSlotId === slot.id ? 'bg-primary/5 border-primary text-primary font-medium' : 'bg-surface border-ink/15 hover:border-primary/40'}`}
                                    >
                                      <div className="font-display">{slot.startTime} - {slot.endTime}</div>
                                      <div className="text-xs mt-1 opacity-70">
                                        {slot.isFull ? text('เต็ม (Full)', 'Full') : isSlotStarted(slot) ? text('หมดเวลาจอง', 'Booking has ended.') : text(`ว่าง ${slot.available} คิว`, `${slot.available} left`)}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">{text('ไม่มีช่วงเวลาเปิดรับจองในวันนี้', 'No time slots available for this date.')}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-display font-medium text-primary mb-3 text-sm">3. {text('ข้อมูลผู้ติดต่อ', 'Contact information')}</h2>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-ink-muted mb-1 block">{text('เรื่องที่มาติดต่อ', 'Reason for visit')}</span>
                <select
                  value={form.contactSubject}
                  onChange={handleChange('contactSubject')}
                  className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                >
                  <option value="">{text('เลือกเรื่องที่มาติดต่อ', 'Select a reason')}</option>
                  {contactSubjects.map((subject) => (
                    <option key={subject.id} value={subject.name}>{subjectName(subject)}</option>
                  ))}
                </select>
              </label>
              <Field label={text('ชื่อ-นามสกุล', 'Full name')} value={form.userName} onChange={handleChange('userName')} placeholder={text('ชื่อ-นามสกุล', 'Full name')} />
              <Field label={text('เบอร์โทรศัพท์', 'Phone number')} value={form.userPhone} onChange={handleChange('userPhone')} placeholder={text('เบอร์โทรศัพท์', 'Phone number')} type="tel" />
              <Field label={text('อีเมล', 'Email')} value={form.userEmail} onChange={handleChange('userEmail')} placeholder={text('อีเมล', 'Email')} type="email" />
            </div>
          </section>

          {error && (
            <p className="text-danger text-sm bg-danger/5 border border-danger/20 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary hover:bg-primary-light disabled:opacity-60 text-white font-display font-medium rounded-2xl py-3.5 transition-colors"
          >
            {submitting ? text('กำลังจองคิว...', 'Booking...') : text('ยืนยันการจองคิว', 'Confirm booking')}
          </button>
        </form>
      </main>
    </div>
  );
}

function LanguageSwitch({ language, onChange }) {
  return <div className="flex rounded-lg border border-ink/15 bg-white p-1 text-xs"><button type="button" onClick={() => onChange('TH')} className={`rounded-md px-2 py-1 ${language === 'TH' ? 'bg-primary text-white' : 'text-ink-muted'}`}>TH</button><button type="button" onClick={() => onChange('EN')} className={`rounded-md px-2 py-1 ${language === 'EN' ? 'bg-primary text-white' : 'text-ink-muted'}`}>EN</button></div>;
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-muted mb-1 block">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
      />
    </label>
  );
}
