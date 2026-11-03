#![cfg(target_os = "macos")]

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::Bool;
use objc2::sel;
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKCalendarType, EKEntityType, EKEvent, EKEventStore, EKSpan,
    EKSourceType,
};
use objc2_core_graphics::CGColor;
use objc2_foundation::{NSArray, NSDate, NSError, NSObjectProtocol, NSString};
use serde::Serialize;

pub const CALENDAR_TITLE: &str = "Reciprocal";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCalendarInfo {
    pub id: String,
    pub title: String,
    pub source: String,
    pub subscribed: bool,
    pub kind: String,
    pub color: String,
    pub allows_modifications: bool,
}

#[derive(Debug, Clone)]
pub struct AppleEventRecord {
    pub external_id: String,
    pub calendar_id: String,
    pub calendar_title: String,
    pub calendar_color: String,
    pub title: String,
    pub notes: String,
    pub location: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub last_modified_ms: i64,
}

#[derive(Debug, Clone)]
pub struct AppleEventPayload {
    pub external_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub location: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
}

fn new_store() -> Retained<EKEventStore> {
    unsafe { EKEventStore::new() }
}

fn ns_string(value: &str) -> Retained<NSString> {
    NSString::from_str(value)
}

fn ms_to_date(ms: i64) -> Retained<NSDate> {
    unsafe { NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0) }
}

pub fn cgcolor_hex(color: Option<&CGColor>) -> String {
    const FALLBACK: &str = "#5B7DB1";
    let Some(color) = color else {
        return FALLBACK.to_string();
    };
    let count = CGColor::number_of_components(Some(color));
    let components = CGColor::components(Some(color));
    if components.is_null() || count == 0 {
        return FALLBACK.to_string();
    }
    let values = unsafe { std::slice::from_raw_parts(components, count) };
    let channel = |value: f64| -> u8 {
        (value.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    let (red, green, blue) = match count {
        1 | 2 => (values[0], values[0], values[0]),
        _ => (values[0], values[1], values[2]),
    };
    format!(
        "#{:02X}{:02X}{:02X}",
        channel(red),
        channel(green),
        channel(blue)
    )
}

fn calendar_color(calendar: &EKCalendar) -> String {
    unsafe { cgcolor_hex(calendar.CGColor().as_deref()) }
}

fn date_to_ms(date: &NSDate) -> i64 {
    (unsafe { date.timeIntervalSince1970() } * 1000.0).round() as i64
}

pub fn authorization_status() -> String {
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    if status == EKAuthorizationStatus::FullAccess {
        "fullAccess".to_string()
    } else if status == EKAuthorizationStatus::WriteOnly {
        "writeOnly".to_string()
    } else if status == EKAuthorizationStatus::Denied {
        "denied".to_string()
    } else if status == EKAuthorizationStatus::Restricted {
        "restricted".to_string()
    } else {
        "notDetermined".to_string()
    }
}

/// Triggers the macOS calendar permission prompt (macOS 14+ full access).
pub fn request_access() -> Result<String, String> {
    let store = new_store();
    if unsafe { !store.respondsToSelector(sel!(requestFullAccessToEventsWithCompletion:)) } {
        return Err("Apple 日曆整合需要 macOS 14 或以上。".into());
    }
    let (sender, receiver) = mpsc::channel::<bool>();
    let handler = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
        let _ = sender.send(granted.as_bool());
    });

    unsafe {
        store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&handler) as *mut _);
    }

    match receiver.recv_timeout(Duration::from_secs(180)) {
        Ok(true) => Ok(authorization_status()),
        Ok(false) => Err(
            "你沒有授予日曆權限，請到「系統設定 → 隱私權與安全性 → 日曆」開啟 Reciprocal。".into(),
        ),
        Err(_) => Err("等待日曆授權逾時，請再試一次。".into()),
    }
}

pub fn list_calendars() -> Result<Vec<AppleCalendarInfo>, String> {
    autoreleasepool(|_| {
        let store = new_store();
        let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        let count = calendars.count();
        let mut result = Vec::with_capacity(count);
        for index in 0..count {
            let calendar = unsafe { calendars.objectAtIndex(index) };
            let kind = unsafe { calendar.r#type() };
            let kind = if kind == EKCalendarType::Subscription {
                "subscription"
            } else if kind == EKCalendarType::Birthday {
                "birthday"
            } else if kind == EKCalendarType::Local {
                "local"
            } else if kind == EKCalendarType::Exchange {
                "exchange"
            } else {
                "caldav"
            };
            result.push(AppleCalendarInfo {
                id: unsafe { calendar.calendarIdentifier() }.to_string(),
                title: unsafe { calendar.title() }.to_string(),
                source: unsafe { calendar.source() }
                    .map(|source| unsafe { source.title() }.to_string())
                    .unwrap_or_default(),
                subscribed: unsafe { calendar.isSubscribed() },
                kind: kind.to_string(),
                color: calendar_color(&calendar),
                allows_modifications: unsafe { calendar.allowsContentModifications() },
            });
        }
        Ok(result)
    })
}

/// Finds or creates the dedicated "Reciprocal" calendar used for events created in the app.
pub fn ensure_calendar() -> Result<String, String> {
    autoreleasepool(|_| {
        let store = new_store();
        let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        for index in 0..calendars.count() {
            let calendar = unsafe { calendars.objectAtIndex(index) };
            if unsafe { calendar.title() }.to_string() == CALENDAR_TITLE {
                return Ok(unsafe { calendar.calendarIdentifier() }.to_string());
            }
        }

        let calendar =
            unsafe { EKCalendar::calendarForEntityType_eventStore(EKEntityType::Event, &store) };
        unsafe { calendar.setTitle(&ns_string(CALENDAR_TITLE)) };
        let brand = CGColor::new_generic_rgb(0.184, 0.420, 0.341, 1.0);
        unsafe { calendar.setCGColor(Some(&brand)) };

        let source = unsafe { store.defaultCalendarForNewEvents() }
            .and_then(|default_calendar| unsafe { default_calendar.source() })
            .or_else(|| {
                let sources = unsafe { store.sources() };
                for index in 0..sources.count() {
                    let candidate = unsafe { sources.objectAtIndex(index) };
                    if unsafe { candidate.sourceType() } == EKSourceType::Local {
                        return Some(candidate);
                    }
                }
                None
            });

        let Some(source) = source else {
            return Err("找不到可以新增日曆的帳號，請先在「日曆」App 登入或建立本機日曆。".into());
        };
        unsafe { calendar.setSource(Some(&source)) };
        unsafe { store.saveCalendar_commit_error(&calendar, true) }.map_err(|error| {
            format!(
                "建立 Reciprocal 日曆失敗：{}",
                unsafe { error.localizedDescription() }
            )
        })?;
        Ok(unsafe { calendar.calendarIdentifier() }.to_string())
    })
}

pub fn fetch_events(
    start_ms: i64,
    end_ms: i64,
    include_calendar_ids: &[String],
    exclude_calendar_id: Option<&str>,
) -> Result<Vec<AppleEventRecord>, String> {
    autoreleasepool(|_| {
        let store = new_store();
        let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        let allowed: std::collections::HashSet<&str> =
            include_calendar_ids.iter().map(String::as_str).collect();
        let filter_enabled = !include_calendar_ids.is_empty();
        let mut selected: Vec<Retained<EKCalendar>> = Vec::new();
        let mut seen_calendars = std::collections::HashSet::new();
        for index in 0..calendars.count() {
            let calendar = unsafe { calendars.objectAtIndex(index) };
            let identifier = unsafe { calendar.calendarIdentifier() }.to_string();
            if let Some(exclude) = exclude_calendar_id {
                if identifier == exclude {
                    continue;
                }
            }
            if filter_enabled && !allowed.contains(identifier.as_str()) {
                continue;
            }
            // The same calendar can appear more than once in the EventKit store
            // (for example when an account is cached twice). Passing duplicate
            // calendar references to the predicate makes EventKit return the
            // same event twice.
            if !seen_calendars.insert(identifier) {
                continue;
            }
            selected.push(calendar);
        }

        let refs: Vec<&EKCalendar> = selected.iter().map(|calendar| &**calendar).collect();
        let array = NSArray::from_slice(&refs);
        let start = ms_to_date(start_ms);
        let end = ms_to_date(end_ms);
        let predicate = unsafe {
            store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, Some(&array))
        };
        let events = unsafe { store.eventsMatchingPredicate(&predicate) };

        let mut result = Vec::with_capacity(events.count());
        for index in 0..events.count() {
            let event = unsafe { events.objectAtIndex(index) };
            let Some(identifier) = (unsafe { event.eventIdentifier() }) else {
                continue;
            };
            let calendar = unsafe { event.calendar() };
            let start_date = unsafe { event.startDate() };
            let end_date = unsafe { event.endDate() };
            result.push(AppleEventRecord {
                external_id: identifier.to_string(),
                calendar_id: calendar
                    .as_ref()
                    .map(|calendar| unsafe { calendar.calendarIdentifier() }.to_string())
                    .unwrap_or_default(),
                calendar_title: calendar
                    .as_ref()
                    .map(|calendar| unsafe { calendar.title() }.to_string())
                    .unwrap_or_default(),
                calendar_color: calendar
                    .as_ref()
                    .map(|calendar| calendar_color(calendar))
                    .unwrap_or_else(|| "#5B7DB1".to_string()),
                title: unsafe { event.title() }.to_string(),
                notes: unsafe { event.notes() }
                    .map(|notes| notes.to_string())
                    .unwrap_or_default(),
                location: unsafe { event.location() }
                    .map(|location| location.to_string())
                    .unwrap_or_default(),
                start_ms: date_to_ms(&start_date),
                end_ms: date_to_ms(&end_date),
                all_day: unsafe { event.isAllDay() },
                last_modified_ms: unsafe { event.lastModifiedDate() }
                    .map(|date| date_to_ms(&date))
                    .unwrap_or(0),
            });
        }
        Ok(result)
    })
}

pub fn upsert_event(
    calendar_id: &str,
    payload: &AppleEventPayload,
) -> Result<String, String> {
    autoreleasepool(|_| {
        let store = new_store();
        let Some(calendar) = (unsafe { store.calendarWithIdentifier(&ns_string(calendar_id)) })
        else {
            return Err("找不到 Reciprocal 日曆，請重新連結 Apple 日曆。".into());
        };
        let event = match &payload.external_id {
            Some(identifier) => unsafe { store.eventWithIdentifier(&ns_string(identifier)) }
                .unwrap_or_else(|| unsafe { EKEvent::eventWithEventStore(&store) }),
            None => unsafe { EKEvent::eventWithEventStore(&store) },
        };

        unsafe {
            event.setCalendar(Some(&calendar));
            event.setTitle(Some(&ns_string(&payload.title)));
            let notes = if payload.notes.trim().is_empty() {
                None
            } else {
                Some(ns_string(&payload.notes))
            };
            event.setNotes(notes.as_deref());
            let location = if payload.location.trim().is_empty() {
                None
            } else {
                Some(ns_string(&payload.location))
            };
            event.setLocation(location.as_deref());
            event.setStartDate(Some(&ms_to_date(payload.start_ms)));
            event.setEndDate(Some(&ms_to_date(payload.end_ms)));
            event.setAllDay(payload.all_day);
            store
                .saveEvent_span_error(&event, EKSpan::ThisEvent)
                .map_err(|error| {
                    format!(
                        "寫入 Apple 日曆失敗：{}",
                        error.localizedDescription()
                    )
                })?;
            Ok(event
                .eventIdentifier()
                .map(|identifier| identifier.to_string())
                .unwrap_or_default())
        }
    })
}

pub fn delete_event(identifier: &str) -> Result<bool, String> {
    autoreleasepool(|_| {
        let store = new_store();
        let Some(event) = (unsafe { store.eventWithIdentifier(&ns_string(identifier)) }) else {
            return Ok(false);
        };
        unsafe { store.removeEvent_span_error(&event, EKSpan::ThisEvent) }.map_err(|error| {
            format!(
                "刪除 Apple 行程失敗：{}",
                unsafe { error.localizedDescription() }
            )
        })?;
        Ok(true)
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_cgcolor_to_hex() {
        let red = CGColor::new_generic_rgb(1.0, 0.0, 0.0, 1.0);
        assert_eq!(cgcolor_hex(Some(&red)), "#FF0000");
        let gray = CGColor::new_generic_gray(0.5, 1.0);
        assert_eq!(cgcolor_hex(Some(&gray)), "#808080");
        assert_eq!(cgcolor_hex(None), "#5B7DB1");
    }
}
