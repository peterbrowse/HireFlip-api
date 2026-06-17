const dateFrom = (value?: string | Date | null) => {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  return Number.isFinite(date.getTime()) ? date : undefined;
};

export const isWorkingDay = (value: string | Date) => {
  const date = dateFrom(value);

  if (!date) {
    return false;
  }

  const day = date.getUTCDay();

  return day !== 0 && day !== 6;
};

export const addWorkingDays = (value: string | Date, days: number) => {
  const date = dateFrom(value);

  if (!date) {
    return undefined;
  }

  const totalDays = Math.max(0, Math.floor(days));
  const result = new Date(date.getTime());
  let addedDays = 0;

  while (addedDays < totalDays) {
    result.setUTCDate(result.getUTCDate() + 1);

    if (isWorkingDay(result)) {
      addedDays += 1;
    }
  }

  return result;
};

export const completedWorkingDaysBetween = (
  fromValue?: string | Date | null,
  toValue: string | Date = new Date()
) => {
  const from = dateFrom(fromValue);
  const to = dateFrom(toValue);

  if (!from || !to || to.getTime() <= from.getTime()) {
    return 0;
  }

  const cursor = new Date(from.getTime());
  let elapsed = 0;

  while (true) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);

    if (cursor.getTime() > to.getTime()) {
      break;
    }

    if (isWorkingDay(cursor)) {
      elapsed += 1;
    }
  }

  return elapsed;
};

export const workingDayWindow = ({
  days,
  from,
  now = new Date(),
}: {
  days: number;
  from?: string | Date | null;
  now?: string | Date;
}) => {
  const start = dateFrom(from);
  const current = dateFrom(now) || new Date();
  const due = start ? addWorkingDays(start, days) : undefined;
  const workingDaysElapsed = completedWorkingDaysBetween(start, current);
  const workingDaysRemaining = Math.max(0, days - workingDaysElapsed);
  const isOverdue = Boolean(due && current.getTime() > due.getTime());

  return {
    dueAt: due?.toISOString() || null,
    isOpen: Boolean(due && current.getTime() <= due.getTime()),
    isOverdue,
    startedAt: start?.toISOString() || null,
    workingDaysElapsed,
    workingDaysRemaining: isOverdue ? 0 : workingDaysRemaining,
    workingDaysTotal: days,
  };
};
