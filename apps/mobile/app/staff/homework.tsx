// A teacher's homework from the phone (docs/specs/HOMEWORK.md, step 2): set homework for a class
// they teach, with a photo of the board or a worksheet, see done counts, and write in the diary.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiFailure, api } from '../../lib/api';
import { useApp } from '../../lib/app';
import { dayLabel } from '../../lib/lessons';
import type { Messages } from '../../lib/messages';
import { color } from '../../lib/theme';
import { Button, Card, Field, Loading, Note, Screen, s } from '../../lib/ui';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Subject = { subjectId: string; name: string };
type MyClass = { sectionId: string; label: string; subjects: Subject[]; classTeacher: boolean };
type Classes = { today: string; nextSchoolDay: string; manager: boolean; classes: MyClass[] };
type SectionView = {
  homework: {
    id: string;
    subject: string;
    title: string;
    dueOn: string;
    state: 'open' | 'withdrawn';
    sections: { sectionId: string; done: number; of: number }[];
  }[];
};
type Warning = { kind: 'sunday' } | { kind: 'holiday'; name: string } | null;
type Photo = { fileId: string; fileName: string };

const errorOf = (t: Messages, e: unknown) =>
  e instanceof ApiFailure
    ? e.status === 403
      ? t.homeworkErrors.forbidden
      : (t.homeworkErrors[e.code] ?? t.error)
    : t.error;

/** A row of choices as radio buttons (classes, subjects). */
function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() => onChange(o.value)}
              style={{
                minHeight: 44,
                paddingHorizontal: 14,
                justifyContent: 'center',
                borderRadius: 8,
                borderWidth: 1,
                borderColor: on ? color.navy950 : color.lineStrong,
                backgroundColor: on ? color.navy50 : color.surface,
              }}
            >
              <Text style={{ ...s.body, color: on ? color.navy950 : color.ink }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TeacherHomeworkScreen() {
  const { t } = useApp();
  const qc = useQueryClient();
  const school = useQuery({
    queryKey: ['institutions'],
    queryFn: () => api.get<{ id: string }[]>('/school/setup/institutions'),
  });
  const id = school.data?.[0]?.id;
  const classes = useQuery({
    queryKey: ['homework-classes', id],
    queryFn: () => api.get<Classes>(`/school/homework/classes?institutionId=${id}`),
    enabled: !!id,
  });
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [diary, setDiary] = useState('');
  const [diarySubject, setDiarySubject] = useState<string | null>(null);
  const list = classes.data?.classes ?? [];
  const cls = list.find((c) => c.sectionId === sectionId) ?? list[0];
  const subject = cls?.subjects.find((x) => x.subjectId === subjectId) ?? cls?.subjects[0];
  const due = dueOn || classes.data?.nextSchoolDay || '';
  const general = !!cls && (cls.classTeacher || !!classes.data?.manager);
  const entrySubject = diarySubject ?? (general ? '' : (cls?.subjects[0]?.subjectId ?? ''));
  const section = useQuery({
    queryKey: ['homework-section', cls?.sectionId],
    queryFn: () => api.get<SectionView>(`/school/homework/sections/${cls?.sectionId}`),
    enabled: !!cls,
  });
  const upload = useMutation({
    mutationFn: (file: { uri: string; name: string; type: string; web?: Blob | null }) =>
      api.upload<{ fileId: string; fileName: string }>(
        `/school/homework/files?institutionId=${id}`,
        file,
      ),
    onSuccess: (p) => setPhotos((cur) => [...cur, p]),
  });
  const pick = async (camera: boolean) => {
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return;
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const r = camera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    upload.mutate({
      uri: a.uri,
      name: a.fileName ?? 'photo.jpg',
      type: a.mimeType ?? 'image/jpeg',
      web: a.file ?? null,
    });
  };
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; warning: Warning }>('/school/homework', {
        institutionId: id,
        sectionIds: [cls?.sectionId],
        subjectId: subject?.subjectId,
        title,
        details,
        dueOn: due,
        fileIds: photos.map((p) => p.fileId),
      }),
    onSuccess: () => {
      setTitle('');
      setDetails('');
      setPhotos([]);
      void qc.invalidateQueries({ queryKey: ['homework-section'] });
    },
  });
  const write = useMutation({
    mutationFn: () =>
      api.post('/school/homework/diary', {
        sectionId: cls?.sectionId,
        onDate: classes.data?.today,
        subjectId: entrySubject || null,
        body: diary,
      }),
    onSuccess: () => setDiary(''),
  });
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (school.isPending || classes.isPending) {
    return (
      <Screen title={t.homework} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (!classes.data || !cls || !subject) {
    const denied = classes.error instanceof ApiFailure && classes.error.status === 403;
    return (
      <Screen title={t.homework} right={back}>
        <Note>{classes.isError && !denied ? t.error : t.denied}</Note>
      </Screen>
    );
  }
  const w = save.data?.warning;
  const today = classes.data.today;
  return (
    <Screen title={t.homework} right={back}>
      <Choices
        label={t.homeworkClass}
        options={list.map((c) => ({ value: c.sectionId, label: c.label }))}
        value={cls.sectionId}
        onChange={(v) => {
          setSectionId(v);
          setSubjectId('');
          setDiarySubject(null);
        }}
      />

      <Text accessibilityRole="header" style={s.lead}>
        {t.setHomework}
      </Text>
      <Card>
        <Choices
          label={t.homeworkSubject}
          options={cls.subjects.map((x) => ({ value: x.subjectId, label: x.name }))}
          value={subject.subjectId}
          onChange={setSubjectId}
        />
        <Field label={t.homeworkTask} value={title} onChangeText={setTitle} maxLength={120} />
        <Field
          label={t.homeworkDetails}
          value={details}
          onChangeText={setDetails}
          multiline
          maxLength={2000}
        />
        <Field
          label={t.dueDate}
          hint={t.dateHint}
          placeholder={classes.data.nextSchoolDay}
          value={dueOn}
          onChangeText={setDueOn}
        />
        {photos.map((p) => (
          <View key={p.fileId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>
              {p.fileName}
            </Text>
            <Button
              label={t.removePhoto(p.fileName)}
              kind="quiet"
              onPress={() => setPhotos((cur) => cur.filter((x) => x.fileId !== p.fileId))}
            />
          </View>
        ))}
        {upload.isPending && <Text style={s.muted}>{t.photoUploading}</Text>}
        {upload.isError && (
          <Note>
            {upload.error instanceof ApiFailure && t.homeworkErrors[upload.error.code]
              ? t.homeworkErrors[upload.error.code]
              : t.photoFailed}
          </Note>
        )}
        {photos.length < 3 && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button label={t.takePhoto} kind="secondary" onPress={() => void pick(true)} />
            <Button label={t.choosePhoto} kind="secondary" onPress={() => void pick(false)} />
          </View>
        )}
        <Button
          label={t.setHomework}
          disabled={!title.trim() || !DATE.test(due) || upload.isPending || save.isPending}
          onPress={() => save.mutate()}
        />
      </Card>
      {save.isSuccess && (
        <Note tone={w ? 'warn' : 'go'}>
          {!w
            ? t.homeworkSaved
            : w.kind === 'sunday'
              ? t.homeworkSunday
              : t.homeworkHoliday(w.name)}
        </Note>
      )}
      {save.isError && <Note>{errorOf(t, save.error)}</Note>}

      {section.data && section.data.homework.some((h) => h.state === 'open') && (
        <Card>
          {section.data.homework
            .filter((h) => h.state === 'open')
            .map((h) => {
              const sec = h.sections.find((x) => x.sectionId === cls.sectionId);
              return (
                <View key={h.id} style={{ gap: 2 }}>
                  <Text style={[s.body, { fontWeight: '600' }]}>
                    {h.subject} · {h.title}
                  </Text>
                  <Text style={[s.muted, { fontVariant: ['tabular-nums'] }]}>
                    {t.dueOn(dayLabel(t, h.dueOn, today))}
                    {sec ? ` · ${t.doneCount(sec.done, sec.of)}` : ''}
                  </Text>
                </View>
              );
            })}
        </Card>
      )}

      <Text accessibilityRole="header" style={s.lead}>
        {t.writeDiary}
      </Text>
      <Card>
        <Choices
          label={t.homeworkSubject}
          options={[
            ...(general ? [{ value: '', label: t.generalNote }] : []),
            ...cls.subjects.map((x) => ({ value: x.subjectId, label: x.name })),
          ]}
          value={entrySubject}
          onChange={setDiarySubject}
        />
        <Field
          label={t.diaryEntry}
          value={diary}
          onChangeText={setDiary}
          multiline
          maxLength={1000}
        />
        <Button
          label={t.writeDiary}
          disabled={!diary.trim() || write.isPending}
          onPress={() => write.mutate()}
        />
      </Card>
      {write.isSuccess && <Note tone="go">{t.diarySaved}</Note>}
      {write.isError && <Note>{errorOf(t, write.error)}</Note>}
    </Screen>
  );
}
