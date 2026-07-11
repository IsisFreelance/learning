import { useState } from 'react'
import { getBusinessHours, minBookableDateStr } from '../lib/bookings'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function todayStr() {
  const d = new Date()
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate())
}

function buildMonthCells(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const totalDays = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let day = 1; day <= totalDays; day++) {
    cells.push({ day, dateStr: toDateStr(year, month, day), weekday: new Date(year, month, day).getDay() })
  }
  return cells
}

function DateField({ label = 'Date', value, onChange, error }) {
  const minDate = minBookableDateStr()
  const [minYear, minMonth] = minDate.split('-').map(Number)
  const [initialYear, initialMonth] = (value || minDate).split('-').map(Number)

  const [viewYear, setViewYear] = useState(initialYear)
  const [viewMonth, setViewMonth] = useState(initialMonth - 1)

  const isAtMinMonth = viewYear === minYear && viewMonth === minMonth - 1

  function goToPrevMonth() {
    if (isAtMinMonth) return
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1)
        return 11
      }
      return m - 1
    })
  }

  function goToNextMonth() {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1)
        return 0
      }
      return m + 1
    })
  }

  const cells = buildMonthCells(viewYear, viewMonth)
  const today = todayStr()

  return (
    <div className="form-field date-field">
      <span className="date-field-label">{label}</span>
      <div className="date-picker">
        <div className="date-picker-header">
          <button
            type="button"
            className="date-picker-nav"
            onClick={goToPrevMonth}
            disabled={isAtMinMonth}
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="date-picker-month">
            {MONTH_LABELS[viewMonth]} {viewYear}
          </span>
          <button type="button" className="date-picker-nav" onClick={goToNextMonth} aria-label="Next month">
            ›
          </button>
        </div>
        <div className="date-picker-grid">
          {WEEKDAY_SHORT.map((w) => (
            <span key={w} className="date-picker-weekday">
              {w}
            </span>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <span key={`blank-${i}`} />
            const closed = !getBusinessHours(cell.dateStr)
            const disabled = cell.dateStr < minDate || closed
            const selected = cell.dateStr === value
            const isToday = cell.dateStr === today
            const classNames = ['date-picker-day']
            if (disabled) classNames.push('is-disabled')
            if (selected) classNames.push('is-selected')
            if (isToday) classNames.push('is-today')
            return (
              <button
                key={cell.dateStr}
                type="button"
                data-date={cell.dateStr}
                className={classNames.join(' ')}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={
                  closed
                    ? `${WEEKDAY_FULL[cell.weekday]}, ${MONTH_LABELS[viewMonth]} ${cell.day}, ${viewYear} — closed`
                    : `${WEEKDAY_FULL[cell.weekday]}, ${MONTH_LABELS[viewMonth]} ${cell.day}, ${viewYear}`
                }
                onClick={() => onChange(cell.dateStr)}
              >
                {cell.day}
              </button>
            )
          })}
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}

export default DateField
