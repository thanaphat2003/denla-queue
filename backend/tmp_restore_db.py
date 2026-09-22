import os, sqlite3, shutil
src = r'c:\Users\Phat IT\Desktop\Denla Queue Project\Version 5 (ใช้ได้แล้ว ไม่มีจองคิว)\school-queue-system\backend\prisma\data\school_queue.db'
dst = r'c:\Users\Phat IT\Desktop\school-queue-system\backend\prisma\data\school_queue.db'
os.makedirs(os.path.dirname(dst), exist_ok=True)
shutil.copy2(src, dst)
conn = sqlite3.connect(dst)
cur = conn.cursor()
for table_name in ['queues']:
    try:
        cur.execute(f'DELETE FROM {table_name}')
        cur.execute(f'DELETE FROM sqlite_sequence WHERE name=?', (table_name,))
    except Exception as e:
        print(f'ERR {table_name}: {e}')
conn.commit()
for table_name in ['services', 'settings', 'admin_users', 'time_slots', 'contact_subjects', 'counters', 'announcements', 'queues']:
    try:
        count = cur.execute(f'SELECT COUNT(*) FROM {table_name}').fetchone()[0]
        print(f'{table_name}: {count}')
    except Exception as e:
        print(f'ERR {table_name}: {e}')
conn.close()
