import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import AdminTopNav from '../components/AdminTopNav.jsx';
import {
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  getAdminSettings,
  saveAdminSetting,
  getAdminCounters,
  createAdminCounter,
  updateAdminCounter,
  deleteAdminCounter,
  getServices,
  createService,
  updateService,
  deleteService,
  reorderServices,
  reorderAdminCounters,
  getAdminContactSubjects,
  createAdminContactSubject,
  updateAdminContactSubject,
  deleteAdminContactSubject,
  reorderAdminContactSubjects,
  getAdminTimeSlots,
  createAdminTimeSlot,
  updateAdminTimeSlot,
  deleteAdminTimeSlot,
  getAdminAnnouncements,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  deleteAdminAnnouncement,
} from '../api.js';

const buildSettings = (items = []) => {
  const settings = {
    siteTitle: '', siteSubtitle: '', siteLogo: '',
    bookingTitle: '', bookingSubtitle: '', bookingLogo: '',
    displayTitle: '', displaySubtitle: '', displayLogo: '',
    queueVoiceTh: '', queueVoiceEn: '', queueSpeechRate: '0.95',
  };
  items.forEach((item) => {
    if (item.key in settings) settings[item.key] = item.value;
  });
  return settings;
};

const requireAdminAccess = (navigateFn) => {
  const isAuthenticated = sessionStorage.getItem('admin-auth') === 'true';
  const role = sessionStorage.getItem('admin-role') || 'ADMIN';
  const allowedRoles = ['ADMIN'];

  if (!isAuthenticated || !allowedRoles.includes(role)) {
    sessionStorage.removeItem('admin-auth');
    sessionStorage.removeItem('admin-role');
    navigateFn('/admin/login', { replace: true });
    return false;
  }

  return true;
};

export default function AdminManagementPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [services, setServices] = useState([]);
  const [counters, setCounters] = useState([]);
  const [contactSubjects, setContactSubjects] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);
  const [editingTimeSlotId, setEditingTimeSlotId] = useState(null);
  const [timeSlotForm, setTimeSlotForm] = useState({ startTime: '', endTime: '', capacity: 10, isActive: true });
  const [announcements, setAnnouncements] = useState([]);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
  const [announcementForm, setAnnouncementForm] = useState({ title: '', body: '', isActive: true, startDate: '', endDate: '' });

  const [settings, setSettings] = useState({ siteTitle: '', siteSubtitle: '', siteLogo: '', bookingTitle: '', bookingSubtitle: '', bookingLogo: '', displayTitle: '', displaySubtitle: '', displayLogo: '', queueVoiceTh: '', queueVoiceEn: '', queueSpeechRate: '0.95' });
  const [availableVoices, setAvailableVoices] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'ADMIN' });
  const [serviceForm, setServiceForm] = useState({ name: '', nameEn: '', description: '', descriptionEn: '', prefix: '', icon: '', iconName: '' });
  const [counterForm, setCounterForm] = useState({ name: '', isActive: true, serviceId: '' });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editingCounterId, setEditingCounterId] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [subjectForm, setSubjectForm] = useState({ name: '', nameEn: '', serviceId: '' });
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false);
  const [activeManageTab, setActiveManageTab] = useState('web');
  const [notice, setNotice] = useState('');
  const [modalState, setModalState] = useState({
    open: false,
    type: 'info',
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'ตกลง',
    cancelText: null,
  });

  useEffect(() => {
    if (!requireAdminAccess(navigate)) return;

    Promise.all([
      getAdminUsers(),
      getAdminSettings(),
      getAdminCounters(),
      getServices(),
      getAdminContactSubjects(),
      getAdminTimeSlots().catch(() => []),
      getAdminAnnouncements().catch(() => []),
    ]).then(([u, s, c, svc, subjects, tSlots, ann]) => {
      setUsers(u);
      setSettings(buildSettings(s));
      setCounters(c);
      setServices(svc);
      setContactSubjects(subjects);
      setTimeSlots(tSlots || []);
      setAnnouncements(ann || []);
    }).catch((err) => {
      console.error('[AdminManagementPage] Failed to load data:', err);
    });
  }, [navigate]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined;

    const loadVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const reloadAdminData = async () => {
    try {
      const [usersData, settingsData, countersData, servicesData, subjectsData, tSlotsData, annData] = await Promise.all([
        getAdminUsers(),
        getAdminSettings(),
        getAdminCounters(),
        getServices(),
        getAdminContactSubjects(),
        getAdminTimeSlots().catch(() => []),
        getAdminAnnouncements().catch(() => []),
      ]);
      setUsers(usersData);
      setSettings(buildSettings(settingsData));
      setCounters(countersData);
      setServices(servicesData);
      setContactSubjects(subjectsData);
      setTimeSlots(tSlotsData || []);
      setAnnouncements(annData || []);
    } catch (err) {
      console.error('[reloadAdminData] error:', err);
    }
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, open: false, onConfirm: null, cancelText: null }));
  };

  const showModal = (title, message, type = 'info', options = {}) => {
    const { onConfirm = null, confirmText = 'ตกลง', cancelText = null } = options;
    setModalState({ open: true, type, title, message, onConfirm, confirmText, cancelText });
  };

  const showAlert = (title, message, type = 'success') => {
    showModal(title, message, type, { confirmText: 'ตกลง' });
  };

  const resetUserForm = () => {
    setEditingUserId(null);
    setForm({ username: '', password: '', role: 'ADMIN' });
  };

  const editUser = (user) => {
    setEditingUserId(user.id);
    setForm({ username: user.username || '', password: '', role: user.role || 'ADMIN' });
  };

  const addUser = async (e) => {
    e.preventDefault();
    const username = String(form.username || '').trim();
    const password = String(form.password || '').trim();

    if (!username) {
      showAlert('บันทึกไม่สำเร็จ', 'กรุณากรอกชื่อผู้ใช้', 'error');
      return;
    }

    if (!editingUserId && !password) {
      showAlert('บันทึกไม่สำเร็จ', 'กรุณากรอกรหัสผ่าน', 'error');
      return;
    }

    try {
      const payload = { username, role: form.role || 'ADMIN' };
      if (password) payload.password = password;

      if (editingUserId) {
        await updateAdminUser(editingUserId, payload);
        setNotice('แก้ไขผู้ดูแลสำเร็จ');
        showAlert('สำเร็จ', 'แก้ไขผู้ดูแลสำเร็จ');
      } else {
        await createAdminUser(payload);
        setNotice('เพิ่มผู้ดูแลสำเร็จ');
        showAlert('สำเร็จ', 'เพิ่มผู้ดูแลสำเร็จ');
      }

      await reloadAdminData();
      resetUserForm();
    } catch (err) {
      const message = err?.response?.data?.error || 'บันทึกผู้ดูแลไม่สำเร็จ';
      setNotice(message);
      showAlert('บันทึกไม่สำเร็จ', message, 'error');
    }
  };

  const removeUser = (id) => {
    confirmAction('ต้องการลบผู้ดูแลรายนี้ใช่หรือไม่', async () => {
      try {
        await deleteAdminUser(id);
        if (editingUserId === id) resetUserForm();
        await reloadAdminData();
        setNotice('ลบผู้ดูแลสำเร็จ');
        showAlert('สำเร็จ', 'ลบผู้ดูแลสำเร็จ');
      } catch (err) {
        const message = err?.response?.data?.error || 'ลบผู้ดูแลไม่สำเร็จ';
        setNotice(message);
        showAlert('บันทึกไม่สำเร็จ', message, 'error');
      }
      closeModal();
    });
  };

  const confirmAction = (message, onConfirm) => {
    showModal('ยืนยันการดำเนินการ', message, 'confirm', {
      onConfirm,
      confirmText: 'ยืนยัน',
      cancelText: 'ยกเลิก',
    });
  };

  const resetServiceForm = () => {
    setEditingServiceId(null);
    setServiceForm({
      name: '',
      nameEn: '',
      description: '',
      descriptionEn: '',
      prefix: '',
      icon: '',
      iconName: '',
    });
  };

  const resetCounterForm = () => {
    setEditingCounterId(null);
    setCounterForm({
      name: '',
      isActive: true,
      serviceId: services[0]?.id ? String(services[0].id) : '',
    });
  };

  const handleLogoFile = (event, settingKey = 'siteLogo') => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 512;
        const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(
          image,
          (image.naturalWidth - cropSize) / 2,
          (image.naturalHeight - cropSize) / 2,
          cropSize,
          cropSize,
          0, 0, size, size
        );
        setSettings((prev) => ({ ...prev, [settingKey]: canvas.toDataURL('image/jpeg', 0.88) }));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setNotice('');
    try {
      await saveAdminSetting({ key: 'siteTitle', value: settings.siteTitle || '' });
      await saveAdminSetting({ key: 'siteSubtitle', value: settings.siteSubtitle || '' });
      await saveAdminSetting({ key: 'siteLogo', value: settings.siteLogo || '' });
      await saveAdminSetting({ key: 'bookingTitle', value: settings.bookingTitle || '' });
      await saveAdminSetting({ key: 'bookingSubtitle', value: settings.bookingSubtitle || '' });
      await saveAdminSetting({ key: 'bookingLogo', value: settings.bookingLogo || '' });
      await saveAdminSetting({ key: 'displayTitle', value: settings.displayTitle || '' });
      await saveAdminSetting({ key: 'displaySubtitle', value: settings.displaySubtitle || '' });
      await saveAdminSetting({ key: 'displayLogo', value: settings.displayLogo || '' });
      await saveAdminSetting({ key: 'queueVoiceTh', value: settings.queueVoiceTh || '' });
      await saveAdminSetting({ key: 'queueVoiceEn', value: settings.queueVoiceEn || '' });
      await saveAdminSetting({ key: 'queueSpeechRate', value: settings.queueSpeechRate || '0.95' });
      document.title = settings.siteTitle || 'DENLA RAMA 5';
      setNotice('บันทึกการตั้งค่าสำเร็จ');
      showAlert('สำเร็จ', 'บันทึกการตั้งค่าสำเร็จ');
    } catch (err) {
      setNotice(err?.response?.data?.error || 'บันทึกการตั้งค่าไม่สำเร็จ');
      showAlert('ผิดพลาด', 'บันทึกการตั้งค่าไม่สำเร็จ', 'error');
    }
  };

  const saveTimeSlot = async (e) => {
    e.preventDefault();
    if (!timeSlotForm.startTime || !timeSlotForm.endTime) return showAlert('Error', 'กรุณาระบุเวลาให้ครบ', 'error');
    try {
      if (editingTimeSlotId) {
        await updateAdminTimeSlot(editingTimeSlotId, timeSlotForm);
      } else {
        await createAdminTimeSlot(timeSlotForm);
      }
      setEditingTimeSlotId(null);
      setTimeSlotForm({ startTime: '', endTime: '', capacity: 10, isActive: true });
      await reloadAdminData();
      showAlert('สำเร็จ', editingTimeSlotId ? 'อัปเดตช่วงเวลาแล้ว' : 'เพิ่มช่วงเวลาแล้ว', 'success');
    } catch (err) {
      showAlert('Error', err?.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    }
  };

  const removeTimeSlot = (id) => {
    confirmAction('ลบช่วงเวลานี้หรือไม่?', async () => {
      try {
        await deleteAdminTimeSlot(id);
        await reloadAdminData();
        showAlert('สำเร็จ', 'ลบช่วงเวลาสำเร็จ', 'success');
      } catch (err) {
        showAlert('Error', err?.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
      }
    });
  };

  const editTimeSlot = (slot) => {
    setEditingTimeSlotId(slot.id);
    setTimeSlotForm({ startTime: slot.startTime, endTime: slot.endTime, capacity: slot.capacity, isActive: slot.isActive });
  };

  const saveAnnouncement = async (e) => {
    e.preventDefault();
    if (!announcementForm.title || !announcementForm.body) {
      return showAlert('Error', 'กรุณาระบุหัวข้อและรายละเอียดประกาศ', 'error');
    }
    try {
      const payload = {
        title: announcementForm.title,
        body: announcementForm.body,
        isActive: announcementForm.isActive,
        startDate: announcementForm.startDate || null,
        endDate: announcementForm.endDate || null,
      };
      if (editingAnnouncementId) {
        await updateAdminAnnouncement(editingAnnouncementId, payload);
      } else {
        await createAdminAnnouncement(payload);
      }
      setEditingAnnouncementId(null);
      setAnnouncementForm({ title: '', body: '', isActive: true, startDate: '', endDate: '' });
      await reloadAdminData();
      showAlert('สำเร็จ', editingAnnouncementId ? 'อัปเดตประกาศแล้ว' : 'โพสต์ประกาศแล้ว', 'success');
    } catch (err) {
      showAlert('Error', err?.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    }
  };

  const removeAnnouncement = (id) => {
    confirmAction('ลบประกาศนี้หรือไม่?', async () => {
      try {
        await deleteAdminAnnouncement(id);
        await reloadAdminData();
        showAlert('สำเร็จ', 'ลบประกาศแล้ว', 'success');
      } catch (err) {
        showAlert('Error', err?.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
      }
    });
  };

  const editAnnouncement = (ann) => {
    setEditingAnnouncementId(ann.id);
    setAnnouncementForm({
      title: ann.title,
      body: ann.body,
      isActive: ann.isActive,
      startDate: ann.startDate ? ann.startDate.split('T')[0] : '',
      endDate: ann.endDate ? ann.endDate.split('T')[0] : '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  const saveService = async (e) => {
    e.preventDefault();
    setNotice('');

    try {
      if (editingServiceId) {
        const updated = await updateService(editingServiceId, serviceForm);
        setServices((prev) => prev.map((item) => (item.id === editingServiceId ? updated : item)));
        setNotice('แก้ไขประเภทบริการสำเร็จ');
        showAlert('สำเร็จ', 'แก้ไขประเภทบริการสำเร็จ');
      } else {
        const created = await createService(serviceForm);
        setServices((prev) => [...prev, created]);
        setNotice('เพิ่มประเภทบริการสำเร็จ');
        showAlert('สำเร็จ', 'เพิ่มประเภทบริการสำเร็จ');
      }
      await reloadAdminData();
      resetServiceForm();
    } catch (err) {
      const message = err?.response?.data?.error || 'บันทึกประเภทบริการไม่สำเร็จ';
      setNotice(message);
      showAlert('บันทึกไม่สำเร็จ', message, 'error');
    }
  };

  const handleServiceIconFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 256;
        const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(
          image,
          (image.naturalWidth - cropSize) / 2,
          (image.naturalHeight - cropSize) / 2,
          cropSize,
          cropSize,
          0,
          0,
          size,
          size
        );
        setServiceForm((prev) => ({ ...prev, icon: canvas.toDataURL('image/jpeg', 0.88), iconName: prev.iconName || file.name }));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const editService = (service) => {
    setEditingServiceId(service.id);
    setServiceForm({
      name: service.name,
      nameEn: service.nameEn || '',
      description: service.description || '',
      descriptionEn: service.descriptionEn || '',
      prefix: service.prefix,
      icon: /^data:image\//i.test(service.icon || '') ? service.icon : '',
      iconName: service.iconName || '',
    });
  };

  const removeService = async (id) => {
    confirmAction('ต้องการลบประเภทบริการนี้ใช่หรือไม่', async () => {
      closeModal();
      try {
        await deleteService(id);
        setServices((prev) => prev.filter((service) => service.id !== id));
        await reloadAdminData();
        setNotice('ลบประเภทบริการสำเร็จ');
        showAlert('สำเร็จ', 'ลบประเภทบริการสำเร็จ');
      } catch (err) {
        const message = err?.response?.data?.error || 'ลบประเภทบริการไม่สำเร็จ';
        setNotice(message);
        showAlert('บันทึกไม่สำเร็จ', message, 'error');
      }
    });
  };

  const resetSubjectForm = () => {
    setSubjectForm({ name: '', nameEn: '', serviceId: services[0]?.id ? String(services[0].id) : '' });
    setEditingSubjectId(null);
  };

  const saveSubject = async (e) => {
    e.preventDefault();
    const name = subjectForm.name.trim();
    if (!name || !subjectForm.serviceId) {
      setNotice('กรุณากรอกเรื่องที่มาติดต่อและเลือกประเภทบริการ');
      return;
    }
    const payload = { name, nameEn: subjectForm.nameEn.trim(), serviceId: Number(subjectForm.serviceId) };
    try {
      if (editingSubjectId) await updateAdminContactSubject(editingSubjectId, payload);
      else await createAdminContactSubject(payload);
      await reloadAdminData();
      resetSubjectForm();
      setNotice('บันทึกเรื่องที่มาติดต่อสำเร็จ');
    } catch (err) {
      setNotice(err?.response?.data?.error || 'บันทึกเรื่องที่มาติดต่อไม่สำเร็จ');
    }
  };

  const editSubject = (subject) => {
    setEditingSubjectId(subject.id);
    setSubjectForm({ name: subject.name, nameEn: subject.nameEn || '', serviceId: subject.serviceId ? String(subject.serviceId) : '' });
  };

  const removeSubject = async (id) => {
    try {
      await deleteAdminContactSubject(id);
      await reloadAdminData();
      setNotice('ลบเรื่องที่มาติดต่อสำเร็จ');
    } catch (err) {
      setNotice(err?.response?.data?.error || 'ลบเรื่องที่มาติดต่อไม่สำเร็จ');
    }
  };

  const saveCounter = async (e) => {
    e.preventDefault();
    setNotice('');

    const trimmedName = String(counterForm.name || '').trim();
    if (!trimmedName) {
      const message = 'กรุณากรอกชื่อช่องบริการ';
      setNotice(message);
      showAlert('บันทึกไม่สำเร็จ', message, 'error');
      return;
    }

    if (!counterForm.serviceId) {
      const message = 'กรุณาเลือกประเภทบริการก่อนบันทึก';
      setNotice(message);
      showAlert('บันทึกไม่สำเร็จ', message, 'error');
      return;
    }

    const payload = {
      name: trimmedName,
      isActive: counterForm.isActive,
      serviceId: Number(counterForm.serviceId),
    };

    try {
      if (editingCounterId) {
        const updated = await updateAdminCounter(editingCounterId, payload);
        setCounters((prev) => prev.map((item) => (item.id === editingCounterId ? updated : item)));
        setNotice('แก้ไขช่องบริการสำเร็จ');
        showAlert('สำเร็จ', 'แก้ไขช่องบริการสำเร็จ');
      } else {
        const created = await createAdminCounter(payload);
        setCounters((prev) => [...prev, created]);
        setNotice('เพิ่มช่องบริการสำเร็จ');
        showAlert('สำเร็จ', 'เพิ่มช่องบริการสำเร็จ');
      }
      await reloadAdminData();
      resetCounterForm();
    } catch (err) {
      const message = err?.response?.data?.error || 'บันทึกช่องบริการไม่สำเร็จ';
      setNotice(message);
      showAlert('บันทึกไม่สำเร็จ', message, 'error');
    }
  };

  const editCounter = (counter) => {
    setEditingCounterId(counter.id);
    setCounterForm({
      name: counter.name,
      isActive: counter.isActive,
      serviceId: counter.service?.id ? String(counter.service.id) : '',
    });
  };

  const removeCounter = async (id) => {
    confirmAction('ต้องการลบช่องบริการนี้ใช่หรือไม่', async () => {
      try {
        await deleteAdminCounter(id);
        setCounters((prev) => prev.filter((counter) => counter.id !== id));
        await reloadAdminData();
        setNotice('ลบช่องบริการสำเร็จ');
        showAlert('สำเร็จ', 'ลบช่องบริการสำเร็จ');
      } catch (err) {
        const message = err?.response?.data?.error || 'ลบช่องบริการไม่สำเร็จ';
        setNotice(message);
        showAlert('บันทึกไม่สำเร็จ', message, 'error');
      }
      closeModal();
    });
  };

  const handleDragStart = (type, id, event, serviceId = null) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(id));
    setDraggedItem({ type, id, serviceId });
  };

  const handleDrop = async (type, targetId) => {
    if (!draggedItem || draggedItem.type !== type || draggedItem.id === targetId) return;

    const items = type === 'service' ? services : counters;
    const setItems = type === 'service' ? setServices : setCounters;
    const saveOrder = type === 'service' ? reorderServices : reorderAdminCounters;
    const sourceIndex = items.findIndex((item) => item.id === draggedItem.id);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const reordered = [...items];
    const [movedItem] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);
    const orderedItems = reordered.map((item, index) => ({ ...item, sortOrder: index }));
    setItems(orderedItems);
    setDraggedItem(null);

    try {
      await saveOrder(orderedItems.map((item, index) => ({ id: item.id, sortOrder: index })));
      setNotice('บันทึกลำดับรายการสำเร็จ');
    } catch (err) {
      setNotice(err?.response?.data?.error || 'บันทึกลำดับรายการไม่สำเร็จ');
      await reloadAdminData();
    }
  };

  const previewQueueVoice = (language) => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(
      language === 'EN' ? 'Now serving A zero zero one at counter one.' : 'ขอเชิญหมายเลข เอ ศูนย์ ศูนย์ หนึ่ง ที่ช่องบริการที่ หนึ่ง'
    );
    utterance.lang = language === 'EN' ? 'en-US' : 'th-TH';
    utterance.rate = Number(settings.queueSpeechRate) || 0.95;
    const voiceName = language === 'EN' ? settings.queueVoiceEn : settings.queueVoiceTh;
    const voice = availableVoices.find((item) => item.name === voiceName);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleSubjectDrop = async (targetId, serviceId) => {
    if (!draggedItem || draggedItem.type !== 'subject' || draggedItem.serviceId !== serviceId || draggedItem.id === targetId) return;

    const subjectsForService = contactSubjects
      .filter((subject) => subject.serviceId === serviceId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const sourceIndex = subjectsForService.findIndex((subject) => subject.id === draggedItem.id);
    const targetIndex = subjectsForService.findIndex((subject) => subject.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const reordered = [...subjectsForService];
    const [movedSubject] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, movedSubject);
    const orderedSubjects = reordered.map((subject, index) => ({ ...subject, sortOrder: index }));
    const orderById = new Map(orderedSubjects.map((subject) => [subject.id, subject]));

    setContactSubjects((previous) => previous.map((subject) => orderById.get(subject.id) || subject));
    setDraggedItem(null);

    try {
      await reorderAdminContactSubjects(orderedSubjects.map((subject, index) => ({ id: subject.id, sortOrder: index })));
      setNotice('บันทึกลำดับ Tag สำเร็จ');
    } catch (err) {
      setNotice(err?.response?.data?.error || 'บันทึกลำดับ Tag ไม่สำเร็จ');
      await reloadAdminData();
    }
  };

  return (
    <div className="min-h-screen bg-canvas font-body">
      <Modal
        open={modalState.open}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
        confirmText={modalState.confirmText}
        cancelText={modalState.cancelText}
        onConfirm={modalState.onConfirm}
        onClose={closeModal}
      />
      <AdminTopNav />

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="bg-surface rounded-2xl p-6 shadow-sm">
          <h1 className="font-display text-2xl text-primary">จัดการเว็บไซต์และระบบคิว</h1>
          <p className="text-sm text-ink-muted mt-2">จัดการผู้ดูแล, ประเภทบริการ, ช่องบริการ, และชื่อเว็บโดยไม่ต้องแก้โค้ด</p>
          {notice && <p className="mt-3 text-sm text-success">{notice}</p>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
          <aside className="bg-surface rounded-2xl border border-primary/10 p-4 shadow-sm h-fit sticky top-6">
            <h2 className="font-display text-lg text-primary mb-4">เมนูจัดการ</h2>
            <nav className="space-y-2">
              {[
                { id: 'web', label: '1. แก้ไขเว็บ' },
                { id: 'booking', label: '2. แก้ไขหน้าจองคิว' },
                { id: 'display', label: '3. แก้ไขหน้าแสดงผล' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveManageTab(tab.id)}
                  className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                    activeManageTab === tab.id
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-ink/5 text-ink hover:bg-ink/10'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="space-y-6">
            {activeManageTab === 'web' && (
              <>
                <section className="bg-surface rounded-2xl p-6 shadow-sm">
                  <h2 className="font-display text-lg text-primary mb-3">ตั้งค่าเว็บ</h2>
                  <form onSubmit={saveSettings} className="space-y-3">
                    <input value={settings.siteTitle || ''} onChange={(e) => setSettings((prev) => ({ ...prev, siteTitle: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="ชื่อเว็บ" />
                    <input value={settings.siteSubtitle || ''} onChange={(e) => setSettings((prev) => ({ ...prev, siteSubtitle: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="คำอธิบายเว็บ" />
                    <label className="block">
                      <span className="text-xs text-ink-muted mb-1 block">Logo เว็บไซต์</span>
                      <input type="file" accept="image/*" onChange={handleLogoFile} className="w-full rounded-xl border px-3 py-2" />
                    </label>
                    {settings.siteLogo && <img src={settings.siteLogo} alt="Logo preview" className="h-20 w-20 rounded-xl object-contain border bg-white" />}
                    <button className="bg-primary text-white rounded-xl px-4 py-2">บันทึก</button>
                  </form>
                </section>

                <section className="bg-surface rounded-2xl p-6 shadow-sm">
                  <h2 className="font-display text-lg text-primary mb-3">{editingUserId ? 'แก้ไขผู้ดูแล' : 'เพิ่มผู้ดูแล'}</h2>
                  <form onSubmit={addUser} className="space-y-3">
                    <input value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="ชื่อผู้ใช้" />
                    <input value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder={editingUserId ? 'รหัสผ่านใหม่ (เว้นว่างหากไม่ต้องการเปลี่ยน)' : 'รหัสผ่าน'} />
                    <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))} className="w-full rounded-xl border px-3 py-2">
                      <option value="ADMIN">ADMIN</option>
                      <option value="MANAGER">MANAGER</option>
                    </select>
                    <div className="flex gap-2">
                      <button className="bg-primary text-white rounded-xl px-4 py-2">{editingUserId ? 'บันทึก' : 'เพิ่มผู้ดูแล'}</button>
                      {editingUserId ? <button type="button" onClick={resetUserForm} className="rounded-xl border px-4 py-2">ยกเลิก</button> : null}
                    </div>
                  </form>
                  <ul className="mt-4 space-y-2">
                    {users.map((user) => (
                      <li key={user.id} className="flex items-center justify-between gap-3 text-sm border-b py-2">
                        <span>{user.username} ({user.role})</span>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => editUser(user)} className="text-primary underline">แก้ไข</button>
                          <button type="button" onClick={() => removeUser(user.id)} className="text-danger underline">ลบ</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}

            {activeManageTab === 'booking' && (
              <>
                <section className="bg-surface rounded-2xl p-6 shadow-sm">
                  <h2 className="font-display text-lg text-primary mb-3">ตั้งค่าหน้าจองคิว</h2>
                  <form onSubmit={saveSettings} className="space-y-3">
                    <input value={settings.bookingTitle || ''} onChange={(e) => setSettings((prev) => ({ ...prev, bookingTitle: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="หัวข้อหน้าจองคิว" />
                    <input value={settings.bookingSubtitle || ''} onChange={(e) => setSettings((prev) => ({ ...prev, bookingSubtitle: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="คำอธิบายหน้าจองคิว" />
                    <input type="file" accept="image/*" onChange={(e) => handleLogoFile(e, 'bookingLogo')} className="w-full rounded-xl border px-3 py-2" />
                    {settings.bookingLogo && <img src={settings.bookingLogo} alt="Booking logo preview" className="h-20 w-20 rounded-xl object-contain border bg-white" />}
                    <button className="bg-primary text-white rounded-xl px-4 py-2">บันทึกหน้าจองคิว</button>
                  </form>
                </section>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <section className="bg-surface rounded-2xl p-6 shadow-sm">
                    <h2 className="font-display text-lg text-primary mb-3">{editingServiceId ? 'แก้ไขประเภทบริการ' : 'เพิ่มประเภทบริการ'}</h2>
                    <form onSubmit={saveService} className="space-y-3">
                      <div className="flex gap-3">
                        <input value={serviceForm.name} onChange={(e) => setServiceForm((prev) => ({ ...prev, name: e.target.value }))} className="flex-1 rounded-xl border px-3 py-2" placeholder="ชื่อบริการ" />
                        <input value={serviceForm.prefix} onChange={(e) => setServiceForm((prev) => ({ ...prev, prefix: e.target.value.toUpperCase() }))} className="w-24 rounded-xl border px-3 py-2" placeholder="A" />
                      </div>
                      <input value={serviceForm.nameEn} onChange={(e) => setServiceForm((prev) => ({ ...prev, nameEn: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="Service name (English)" />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><input value={serviceForm.description} onChange={(e) => setServiceForm((prev) => ({ ...prev, description: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="คำอธิบายบริการ" /><input value={serviceForm.descriptionEn} onChange={(e) => setServiceForm((prev) => ({ ...prev, descriptionEn: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="Service description (English)" /></div>
                      <div className="rounded-xl border border-primary/10 bg-primary/[0.03] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-primary">รูปภาพประเภทบริการ</p>
                            <p className="text-xs text-ink-muted mt-1">ไม่ใส่รูปก็ได้</p>
                          </div>
                          {serviceForm.icon && <img src={serviceForm.icon} alt={serviceForm.iconName || 'ตัวอย่างรูปภาพ'} className="h-14 w-14 rounded-xl object-cover border border-primary/10 bg-white" />}
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-light">
                          <span aria-hidden="true" className="text-base">+</span>
                          {serviceForm.icon ? 'เปลี่ยนรูปภาพ' : 'เพิ่มรูปภาพ'}
                          <input type="file" accept="image/*" onChange={handleServiceIconFile} className="sr-only" />
                        </label>
                        <input value={serviceForm.iconName} onChange={(e) => setServiceForm((prev) => ({ ...prev, iconName: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="ชื่อรูปภาพ" />
                        <p className="text-xs text-ink-muted">ระบบจะ Crop รูปเป็นสี่เหลี่ยมขนาด 256 x 256 อัตโนมัติ</p>
                      </div>

                      <div className="flex gap-2">
                        <button className="bg-primary text-white rounded-xl px-4 py-2">{editingServiceId ? 'บันทึก' : 'เพิ่ม'}</button>
                        {editingServiceId ? <button type="button" onClick={resetServiceForm} className="rounded-xl border px-4 py-2">ยกเลิก</button> : null}
                      </div>
                    </form>
                    <ul className="mt-4 space-y-2">
                      {services.map((service) => {
                        const iconIsImage = /^https?:\/\//i.test(service.icon || '') || /^data:/i.test(service.icon || '');
                        return (
                          <li key={service.id} draggable onDragStart={(e) => handleDragStart('service', service.id, e)} onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop('service', service.id)} className="flex items-center justify-between text-sm border-b py-2 cursor-grab active:cursor-grabbing" title="ลากเพื่อจัดลำดับ">
                            <span className="flex items-center gap-2">
                              {iconIsImage && <img src={service.icon} alt={service.name} className="h-8 w-8 rounded-lg object-cover border" />}
                              <span>{service.name} ({service.prefix})</span>
                            </span>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => editService(service)} className="text-primary underline">แก้ไข</button>
                              <button type="button" onClick={() => removeService(service.id)} className="text-danger underline">ลบ</button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  <section className="bg-surface rounded-2xl p-6 shadow-sm">
                    <h2 className="font-display text-lg text-primary mb-3">{editingSubjectId ? 'แก้ไขเรื่องที่มาติดต่อ' : 'เพิ่มเรื่องที่มาติดต่อ'}</h2>
                    <form onSubmit={saveSubject} className="space-y-3">
                      <select value={subjectForm.serviceId} onChange={(e) => setSubjectForm((prev) => ({ ...prev, serviceId: e.target.value }))} className="w-full rounded-xl border px-3 py-2">
                        <option value="">เลือกประเภทบริการเพื่อจัดหมวดหมู่ Tag</option>
                        {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                      </select>
                      <input value={subjectForm.name} onChange={(e) => setSubjectForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="เรื่องที่มาติดต่อ (ภาษาไทย) เช่น จ่ายค่าเทอม *" />
                      <input value={subjectForm.nameEn || ''} onChange={(e) => setSubjectForm((prev) => ({ ...prev, nameEn: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="Reason for visit (English, optional)" />
                      <div className="flex gap-2">
                        <button disabled={!subjectForm.serviceId || !subjectForm.name.trim()} className="bg-primary text-white rounded-xl px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50">{editingSubjectId ? 'บันทึก' : 'เพิ่ม'}</button>
                        {editingSubjectId ? <button type="button" onClick={resetSubjectForm} className="rounded-xl border px-4 py-2">ยกเลิก</button> : null}
                      </div>
                    </form>
                    <ul className="mt-4 space-y-2">
                      {services.map((service) => (
                        <li key={service.id} className="border-b py-2">
                          <p className="text-xs text-ink-muted mb-2">{service.name}</p>
                          <div className="flex flex-wrap gap-2">
                            {contactSubjects.filter((subject) => subject.serviceId === service.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((subject) => (
                              <span key={subject.id} draggable onDragStart={(e) => handleDragStart('subject', subject.id, e, service.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleSubjectDrop(subject.id, service.id); }} onDragEnd={() => setDraggedItem(null)} className="inline-flex cursor-grab items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs text-primary active:cursor-grabbing" title="ลากเพื่อจัดลำดับ Tag">
                                <span aria-hidden="true" className="select-none text-primary/60">⠿</span>
                                {subject.name}
                                <button type="button" onClick={() => editSubject(subject)} className="underline">แก้ไข</button>
                                <button type="button" onClick={() => removeSubject(subject.id)} className="text-danger">ลบ</button>
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <section className="bg-surface rounded-2xl p-6 shadow-sm lg:col-span-1">
                    <h2 className="font-display text-lg text-primary mb-3">{editingTimeSlotId ? 'แก้ไขช่วงเวลา' : 'เพิ่มช่วงเวลา'}</h2>
                    <form onSubmit={saveTimeSlot} className="space-y-3">
                      <label className="block"><span className="text-xs text-ink-muted mb-1 block">เวลาเริ่ม (Start)</span><input type="time" value={timeSlotForm.startTime} onChange={e => setTimeSlotForm(f => ({ ...f, startTime: e.target.value }))} className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-sm" required /></label>
                      <label className="block"><span className="text-xs text-ink-muted mb-1 block">เวลาสิ้นสุด (End)</span><input type="time" value={timeSlotForm.endTime} onChange={e => setTimeSlotForm(f => ({ ...f, endTime: e.target.value }))} className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-sm" required /></label>
                      <label className="block"><span className="text-xs text-ink-muted mb-1 block">โควตาสูงสุด (Capacity)</span><input type="number" min="1" value={timeSlotForm.capacity} onChange={e => setTimeSlotForm(f => ({ ...f, capacity: Number(e.target.value) }))} className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-sm" required /></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={timeSlotForm.isActive} onChange={e => setTimeSlotForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded text-primary" /><span className="text-sm">เปิดรับจอง (Active)</span></label>
                      <div className="flex gap-2 pt-2">
                        <button type="submit" className="flex-1 bg-primary hover:bg-primary-light text-white font-medium rounded-xl py-2 text-sm">{editingTimeSlotId ? 'บันทึก' : 'เพิ่มช่วงเวลา'}</button>
                        {editingTimeSlotId && <button type="button" onClick={() => { setEditingTimeSlotId(null); setTimeSlotForm({ startTime: '', endTime: '', capacity: 10, isActive: true }); }} className="flex-1 bg-ink/5 hover:bg-ink/10 text-ink font-medium rounded-xl py-2 text-sm">ยกเลิก</button>}
                      </div>
                    </form>
                  </section>

                  <section className="bg-surface rounded-2xl p-6 shadow-sm lg:col-span-2">
                    <h2 className="font-display text-lg text-primary mb-3">ช่วงเวลาทั้งหมด</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead><tr className="border-b border-ink/10 text-ink-muted"><th className="pb-2 pr-4 font-medium">เวลา</th><th className="pb-2 pr-4 font-medium">โควตา</th><th className="pb-2 pr-4 font-medium">สถานะ</th><th className="pb-2 font-medium">จัดการ</th></tr></thead>
                        <tbody className="divide-y divide-ink/5">
                          {timeSlots.map(slot => (
                            <tr key={slot.id} className="hover:bg-ink/5">
                              <td className="py-3 pr-4 font-display">{slot.startTime} - {slot.endTime}</td>
                              <td className="py-3 pr-4">{slot.capacity}</td>
                              <td className="py-3 pr-4"><span className={"inline-flex px-2 py-0.5 rounded-full text-xs font-medium " + (slot.isActive ? 'bg-green-100 text-green-700' : 'bg-ink/10 text-ink-muted')}>{slot.isActive ? 'เปิดรับจอง' : 'ปิดจอง'}</span></td>
                              <td className="py-3"><button type="button" onClick={() => editTimeSlot(slot)} className="text-primary hover:underline text-xs mr-3">แก้ไข</button><button type="button" onClick={() => removeTimeSlot(slot.id)} className="text-red-600 hover:underline text-xs">ลบ</button></td>
                            </tr>
                          ))}
                          {timeSlots.length === 0 && <tr><td colSpan="4" className="py-4 text-center text-ink-muted text-sm">ยังไม่มีช่วงเวลา</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <section className="bg-surface rounded-2xl p-6 shadow-sm">
                  <h2 className="font-display text-xl text-primary font-semibold mb-1">จัดการประกาศ (Announcements)</h2>
                  <p className="text-xs text-ink-muted mb-4">ประกาศที่ Active จะแสดงเป็น Popup อัตโนมัติบนหน้าจองคิวของผู้ปกครอง</p>
                  <div className="space-y-6">
                    <section className="bg-surface rounded-2xl p-6 shadow-sm border border-ink/10">
                      <h3 className="font-display text-base text-primary mb-4">{editingAnnouncementId ? 'แก้ไขประกาศ' : 'สร้างประกาศใหม่'}</h3>
                      <form onSubmit={saveAnnouncement} className="space-y-3">
                        <label className="block"><span className="text-xs text-ink-muted mb-1 block">หัวข้อประกาศ *</span><input type="text" value={announcementForm.title} onChange={e => setAnnouncementForm(f => ({ ...f, title: e.target.value }))} className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-sm" placeholder="หัวข้อประกาศ" required /></label>
                        <label className="block"><span className="text-xs text-ink-muted mb-1 block">รายละเอียด *</span><textarea rows={4} value={announcementForm.body} onChange={e => setAnnouncementForm(f => ({ ...f, body: e.target.value }))} className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-sm resize-none" placeholder="รายละเอียด" required /></label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block"><span className="text-xs text-ink-muted mb-1 block">วันที่เริ่มแสดง</span><input type="date" value={announcementForm.startDate} onChange={e => setAnnouncementForm(f => ({ ...f, startDate: e.target.value }))} className="w-full rounded-xl border border-ink/15 bg-surface px-3 py-2.5 text-sm" /></label>
                          <label className="block"><span className="text-xs text-ink-muted mb-1 block">วันที่สิ้นสุด</span><input type="date" value={announcementForm.endDate} onChange={e => setAnnouncementForm(f => ({ ...f, endDate: e.target.value }))} className="w-full rounded-xl border border-ink/15 bg-surface px-3 py-2.5 text-sm" /></label>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={announcementForm.isActive} onChange={e => setAnnouncementForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded text-primary" /><span className="text-sm font-medium">เปิดใช้งาน (Active)</span></label>
                        <div className="flex gap-2 pt-2">
                          <button type="submit" className="flex-1 bg-primary hover:bg-primary-light text-white font-medium rounded-xl py-2 text-sm">{editingAnnouncementId ? 'บันทึกการแก้ไข' : 'โพสต์ประกาศ'}</button>
                          {editingAnnouncementId && <button type="button" onClick={() => { setEditingAnnouncementId(null); setAnnouncementForm({ title: '', body: '', isActive: true, startDate: '', endDate: '' }); }} className="flex-1 bg-ink/5 hover:bg-ink/10 text-ink font-medium rounded-xl py-2 text-sm">ยกเลิก</button>}
                        </div>
                      </form>
                    </section>
                    <section className="bg-surface rounded-2xl p-6 shadow-sm border border-ink/10">
                      <h3 className="font-display text-base text-primary mb-4">ประกาศทั้งหมด</h3>
                      {announcements.length === 0 ? <p className="text-sm text-ink-muted py-4 text-center">ยังไม่มีประกาศ</p> : <div className="space-y-3">{announcements.map(ann => <div key={ann.id} className="border border-ink/10 rounded-xl p-4"><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap mb-1"><span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + (ann.isActive ? 'bg-green-100 text-green-700' : 'bg-ink/10 text-ink-muted')}>{ann.isActive ? '● Active' : '○ Inactive'}</span>{ann.startDate && <span className="text-xs text-ink-muted">เริ่ม {new Date(ann.startDate).toLocaleDateString('th-TH')}</span>}{ann.endDate && <span className="text-xs text-ink-muted">ถึง {new Date(ann.endDate).toLocaleDateString('th-TH')}</span>}</div><h4 className="font-display font-medium text-ink text-sm">{ann.title}</h4><p className="text-xs text-ink-muted mt-1 line-clamp-2">{ann.body}</p></div><div className="flex gap-2 shrink-0"><button type="button" onClick={() => editAnnouncement(ann)} className="text-primary hover:underline text-xs">แก้ไข</button><button type="button" onClick={() => removeAnnouncement(ann.id)} className="text-red-600 hover:underline text-xs">ลบ</button></div></div></div>)}</div>}
                    </section>
                  </div>
                </section>
              </>
            )}

            {activeManageTab === 'display' && (
              <>
                <section className="bg-surface rounded-2xl p-6 shadow-sm">
                  <h2 className="font-display text-lg text-primary mb-3">ตั้งค่าหน้าแสดงผลและเสียงเรียกคิว</h2>
                  <form onSubmit={saveSettings} className="space-y-3">
                    <input value={settings.displayTitle || ''} onChange={(e) => setSettings((prev) => ({ ...prev, displayTitle: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="หัวข้อหน้าแสดงผล" />
                    <input value={settings.displaySubtitle || ''} onChange={(e) => setSettings((prev) => ({ ...prev, displaySubtitle: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="คำอธิบายหน้าแสดงผล" />
                    <input type="file" accept="image/*" onChange={(e) => handleLogoFile(e, 'displayLogo')} className="w-full rounded-xl border px-3 py-2" />
                    {settings.displayLogo && <img src={settings.displayLogo} alt="Display logo preview" className="h-20 w-20 rounded-xl object-contain border bg-white" />}
                    <div className="border-t border-ink/10 pt-3 space-y-3">
                      <div><span className="text-xs text-ink-muted mb-1 block">เสียงเรียกคิวภาษาไทย</span><div className="flex gap-2"><select value={settings.queueVoiceTh || ''} onChange={(e) => setSettings((prev) => ({ ...prev, queueVoiceTh: e.target.value }))} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"><option value="">ใช้เสียงเริ่มต้นของเบราว์เซอร์</option>{availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith('th')).map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>)}</select><button type="button" onClick={() => previewQueueVoice('TH')} className="rounded-xl border border-primary/20 px-3 py-2 text-sm text-primary">ทดลอง</button></div></div>
                      <div><span className="text-xs text-ink-muted mb-1 block">เสียงเรียกคิวภาษาอังกฤษ</span><div className="flex gap-2"><select value={settings.queueVoiceEn || ''} onChange={(e) => setSettings((prev) => ({ ...prev, queueVoiceEn: e.target.value }))} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"><option value="">ใช้เสียงเริ่มต้นของเบราว์เซอร์</option>{availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith('en')).map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>)}</select><button type="button" onClick={() => previewQueueVoice('EN')} className="rounded-xl border border-primary/20 px-3 py-2 text-sm text-primary">ทดลอง</button></div></div>
                      <label className="block"><span className="text-xs text-ink-muted mb-1 block">ความเร็วเสียง</span><select value={settings.queueSpeechRate || '0.95'} onChange={(e) => setSettings((prev) => ({ ...prev, queueSpeechRate: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm"><option value="0.75">ช้า</option><option value="0.95">ปกติ</option><option value="1.1">เร็ว</option></select></label>
                    </div>
                    <button className="bg-primary text-white rounded-xl px-4 py-2">บันทึกหน้าแสดงผล</button>
                  </form>
                </section>
                <section className="bg-surface rounded-2xl p-6 shadow-sm">
                  <h2 className="font-display text-lg text-primary mb-3">{editingCounterId ? 'แก้ไขช่องบริการ' : 'เพิ่มช่องบริการ'}</h2>
                  <form onSubmit={saveCounter} className="space-y-3">
                    <div className="relative">
                      <button type="button" onClick={() => setServiceDropdownOpen((open) => !open)} className="w-full rounded-xl border px-3 py-2 text-left flex items-center gap-3 bg-white">
                        {(() => { const selected = services.find((service) => String(service.id) === String(counterForm.serviceId)); return selected ? <>{selected.icon && <img src={selected.icon} alt={selected.iconName || selected.name} className="h-8 w-8 rounded-lg object-cover border" />}<span>{selected.name}</span></> : <span className="text-ink-muted">เลือกประเภทบริการ</span>; })()}
                      </button>
                      {serviceDropdownOpen && (
                        <div className="absolute z-10 mt-1 w-full rounded-xl border bg-white p-1 shadow-lg">
                          {services.map((service) => (
                            <button type="button" key={service.id} onClick={() => { setCounterForm((prev) => ({ ...prev, serviceId: String(service.id) })); setServiceDropdownOpen(false); }} className="w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-primary/5">
                              {service.icon && <img src={service.icon} alt={service.iconName || service.name} className="h-8 w-8 rounded-lg object-cover border" />}
                              <span>{service.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input value={counterForm.name} onChange={(e) => setCounterForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-xl border px-3 py-2" placeholder="ชื่อช่องบริการ" />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={counterForm.isActive} onChange={(e) => setCounterForm((prev) => ({ ...prev, isActive: e.target.checked }))} />เปิดใช้งาน</label>
                    <div className="flex gap-2"><button className="bg-primary text-white rounded-xl px-4 py-2">{editingCounterId ? 'บันทึก' : 'เพิ่ม'}</button>{editingCounterId ? <button type="button" onClick={resetCounterForm} className="rounded-xl border px-4 py-2">ยกเลิก</button> : null}</div>
                  </form>
                  <ul className="mt-4 space-y-2">
                    {counters.map((counter) => (
                      <li key={counter.id} draggable onDragStart={(e) => handleDragStart('counter', counter.id, e)} onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop('counter', counter.id)} className="flex items-center justify-between text-sm border-b py-2 cursor-grab active:cursor-grabbing" title="ลากเพื่อจัดลำดับ">
                        <span>{counter.service?.name || 'ไม่มีประเภท'} · {counter.name} · {counter.isActive ? 'เปิด' : 'ปิด'}</span>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => editCounter(counter)} className="text-primary underline">แก้ไข</button>
                          <button type="button" onClick={() => removeCounter(counter.id)} className="text-danger underline">ลบ</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
