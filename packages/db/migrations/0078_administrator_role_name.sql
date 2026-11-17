-- The administrator role serves schools, colleges and universities alike (rule book §12.3), so its
-- ready-made name is "Administrator". Only the untouched default name is changed; a name an
-- organisation chose stays.
UPDATE role SET name = 'Administrator' WHERE key = 'school_admin' AND name = 'School administrator';
