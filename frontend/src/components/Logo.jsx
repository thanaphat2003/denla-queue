import logoDlts from '../assets/logo-dlts.jpg';
import { useEffect, useState } from 'react';
import { getAdminSettings } from '../api.js';

export default function Logo({ className = 'h-10', withText = true, page = 'web' }) {
  const [logo, setLogo] = useState(logoDlts);
  const [title, setTitle] = useState('DENLA RAMA 5');
  const [subtitle, setSubtitle] = useState('ระบบจองคิวติดต่อธุรการ');

  useEffect(() => {
    getAdminSettings().then((settings) => {
      const prefix = page === 'booking' ? 'booking' : page === 'display' ? 'display' : 'site';
      const logoSetting = settings.find((item) => item.key === `${prefix}Logo`) || settings.find((item) => item.key === 'siteLogo');
      const titleSetting = settings.find((item) => item.key === `${prefix}Title`) || settings.find((item) => item.key === 'siteTitle');
      const subtitleSetting = settings.find((item) => item.key === `${prefix}Subtitle`) || settings.find((item) => item.key === 'siteSubtitle');
      if (logoSetting?.value) setLogo(logoSetting.value);
      if (titleSetting?.value) setTitle(titleSetting.value);
      if (subtitleSetting?.value) setSubtitle(subtitleSetting.value);
    }).catch(() => {});
  }, [page]);

  return (
    <div className="flex items-center gap-2.5">
      <img src={logo} alt="Denla Trilingual School" className={`${className} object-contain`} />
      {withText && (
        <div className="leading-tight">
          <p className="font-display font-semibold text-primary text-sm tracking-wide">
            {title}
          </p>
            <p className="text-[11px] text-ink-muted">{subtitle}</p>
        </div>
      )}
    </div>
  );
}
