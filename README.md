# ClassHub

**Your Class. Your Community.**

ClassHub is a notice board for a college class. Notices, exam dates, project deadlines and study notes live in one place, instead of getting lost in WhatsApp groups. The class representative (CR) posts, and every student sees it instantly on their phone.

**Live app:** https://YOUR-VERCEL-LINK

## Why I built it

In my class the CR shares every notice, date and note by hand on WhatsApp. Messages get buried, scanned PDFs are hard to find, and people miss deadlines. ClassHub gives the class one trusted place for all of it.

## Features

- **Three doors:** a ClassMate (student) login, a CR login, and a hidden admin login.
- **Notices with six types:** Exam, Project, Syllabus, Holiday, Event and Announcement, each with its own colour.
- **Photo and PDF notices:** the CR can take a photo, pick one from the gallery or attach a PDF. Photos are shrunk on the phone before upload.
- **Paste-to-fill:** paste a WhatsApp message and the app suggests the title, type, date and time (understands "tomorrow", "kal", weekdays and dates like 5 Nov).
- **Coming up:** the home screen shows what is due in the next 3 days, with a bell badge and a "due tomorrow" reminder.
- **Notes library:** subject-wise notes as a Google Drive link or a PDF.
- **Admin panel:** class stats, a list of students with last-active time, make or remove a CR, remove an account, create new classes and post college-wide notices.
- **Multi-class:** each class has its own code and sees only its own notices. One admin can manage many classes.
- **Live updates:** new notices appear without refreshing.
- **Light and dark themes**, installable on the phone home screen, built phone-first.

## How it works

| Part | Technology |
|---|---|
| App | Plain HTML, CSS and JavaScript (no framework, no build step) |
| Database, login and file storage | [Supabase](https://supabase.com) (Postgres, Auth, Storage, Realtime) |
| Hosting | [Vercel](https://vercel.com) |

### Security

- Students sign up with a **class code**, their **roll number** (format checked) and a **6-digit PIN**. No personal email is collected.
- Who can read or write what is enforced **inside the database** with Row Level Security, not in the app code. A student cannot post, and a CR cannot touch another class, even by calling the API directly.
- Notice photos and PDFs sit in a **private** storage bucket and are opened through short-lived signed links.
- Roles (student, CR, admin) are stored in the database and can only be changed by the admin.
- Only the public (publishable) Supabase key is used in the app. No secret keys are in this repository.

## Run your own copy

1. Create a free Supabase project and turn **off** "Confirm email" (Authentication, Providers, Email).
2. Run `schema.sql` in the Supabase SQL Editor. It creates the tables, security rules and storage.
3. Create your class: `insert into public.classes (name, code) values ('My Class', 'MY-CODE-26');`
4. Put your Supabase project URL and publishable key in `config.js`.
5. Deploy this folder on Vercel (framework preset: Other).
6. Sign up in the app with your class code, then make yourself admin:
   `update public.profiles set role = 'admin' where roll = 'YOUR-ROLL';`

## Not built yet

- Push notifications when the app is closed.
- Reading the text of notice photos and scanned PDFs automatically.

## Author

Built by [@rajyadav-dev](https://github.com/rajyadav-dev), with AI help.
