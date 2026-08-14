//! Pausing and resuming a running download.
//!
//! The Electron build implemented pause by holding incoming bytes in the main
//! process's memory while keeping the localhost HTTP connection alive. There
//! is no HTTP hop here — yt-dlp writes to disk itself — so pause instead
//! suspends the yt-dlp process at the OS level. Its sockets stay open and its
//! partial output stays on disk, so resuming continues the same transfer
//! rather than restarting it, and nothing is buffered in this app's memory no
//! matter how long the pause lasts.
//!
//! Caveat worth knowing: YouTube's CDN can time a stalled connection out on
//! its own. A pause of a few minutes resumes cleanly; one left for an hour
//! may fail on resume, at which point the download reports an error and the
//! user restarts it. That is a real limit of pausing a live transfer, not
//! something the old byte-buffering approach solved either (it just moved the
//! cost into unbounded memory growth).

/// Suspends every thread in the target process.
///
/// Windows has no signal equivalent, so this walks the process's threads and
/// calls SuspendThread on each. yt-dlp spawns ffmpeg as a child for the merge
/// step, but merging happens after all bytes are downloaded — the pause
/// controls are hidden by then — so suspending yt-dlp itself is sufficient.
#[cfg(windows)]
pub fn suspend_process(pid: u32) -> Result<(), String> {
    unsafe { for_each_thread(pid, |handle| winapi::um::processthreadsapi::SuspendThread(handle)) }
}

#[cfg(windows)]
pub fn resume_process(pid: u32) -> Result<(), String> {
    unsafe { for_each_thread(pid, |handle| winapi::um::processthreadsapi::ResumeThread(handle)) }
}

#[cfg(windows)]
unsafe fn for_each_thread(
    pid: u32,
    action: impl Fn(winapi::um::winnt::HANDLE) -> u32,
) -> Result<(), String> {
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
    use winapi::um::processthreadsapi::OpenThread;
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use winapi::um::winnt::THREAD_SUSPEND_RESUME;

    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("Could not inspect the download process".into());
    }

    let mut entry: THREADENTRY32 = std::mem::zeroed();
    entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;

    let mut found = false;
    let mut ok = Thread32First(snapshot, &mut entry);
    while ok != 0 {
        if entry.th32OwnerProcessID == pid {
            let handle = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
            if !handle.is_null() {
                action(handle);
                CloseHandle(handle);
                found = true;
            }
        }
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        ok = Thread32Next(snapshot, &mut entry);
    }

    CloseHandle(snapshot);

    if found {
        Ok(())
    } else {
        Err("The download is no longer running".into())
    }
}

#[cfg(unix)]
pub fn suspend_process(pid: u32) -> Result<(), String> {
    signal(pid, 19 /* SIGSTOP */)
}

#[cfg(unix)]
pub fn resume_process(pid: u32) -> Result<(), String> {
    signal(pid, 18 /* SIGCONT */)
}

#[cfg(unix)]
fn signal(pid: u32, sig: i32) -> Result<(), String> {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    let result = unsafe { kill(pid as i32, sig) };
    if result == 0 {
        Ok(())
    } else {
        Err("The download is no longer running".into())
    }
}
