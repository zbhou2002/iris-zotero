// Launch Services gives this small app its own microphone consent identity.
// Keep the Python child attached until it exits; cancellation never leaves a mic open.
#import <Cocoa/Cocoa.h>
#import <AVFoundation/AVFoundation.h>
#import <signal.h>

static NSDictionary *job;
static NSTask *child;
static BOOL finished = NO;
static NSString *root;
static NSDate *deadline;
static void writeJSON(NSString *path, NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    [data writeToFile:path options:NSDataWritingAtomic error:nil];
}
static BOOL exists(NSString *path) { return [[NSFileManager defaultManager] fileExistsAtPath:path]; }
static void finish(NSDictionary *result) {
    if (finished) return;
    finished = YES;
    if (child.running) {
        [child terminate];
        // A hung native decoder must not survive a cancelled session.
        for (int i = 0; i < 20 && child.running; i++) [NSThread sleepForTimeInterval:0.05];
        if (child.running) kill(child.processIdentifier, SIGKILL);
        [child waitUntilExit];
    }
    if (result && exists(job[@"job"])) writeJSON(job[@"done"], result);
    [NSApp terminate:nil];
}
static void startPython(void) {
    if (finished) return;
    child = [NSTask new];
    child.executableURL = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"venv/bin/python"]];
    child.arguments = @[[root stringByAppendingPathComponent:@"iris-speech.py"], @"run", @"--root", root, @"--job", job[@"job"]];
    child.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    child.standardError = [NSFileHandle fileHandleWithNullDevice];
    child.terminationHandler = ^(NSTask *task) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!finished) finish(exists(job[@"done"]) ? nil : @{@"ok": @NO, @"error": @"Local speech process exited unexpectedly", @"code": @"process_failed"});
        });
    };
    NSError *error;
    if (![child launchAndReturnError:&error]) finish(@{@"ok": @NO, @"error": error.localizedDescription});
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 2;
        root = [NSString stringWithUTF8String:argv[1]];
        NSString *jobPath = [NSString stringWithUTF8String:argv[2]];
        NSData *jobData = [NSData dataWithContentsOfFile:jobPath];
        if (!jobData) return 2;
        job = [NSJSONSerialization JSONObjectWithData:jobData options:0 error:nil];
        if (![job isKindOfClass:[NSDictionary class]]) return 2;
        // Only operate on files in the dedicated runtime directory.
        for (NSString *key in @[@"job", @"done", @"status", @"stop", @"cancel"]) {
            if (![job[key] isKindOfClass:[NSString class]] ||
                ![[job[key] stringByDeletingLastPathComponent] isEqualToString:root]) return 2;
        }
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        deadline = [NSDate dateWithTimeIntervalSinceNow:240];
        [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
            if (!exists(job[@"job"]) || exists(job[@"cancel"])) finish(@{@"ok": @NO, @"cancelled": @YES});
            else if ([deadline timeIntervalSinceNow] < 0) finish(@{@"ok": @NO, @"error": @"Speech recording or recognition timed out"});
        }];
        dispatch_async(dispatch_get_main_queue(), ^{
            if ([job[@"permissionProbe"] boolValue]) {
                AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
                finish(@{@"ok": @YES, @"permissionStatus": @(status)});
                return;
            }
            // Audio fixtures test the real app/child transport without requesting a mic.
            if (job[@"audio"]) { startPython(); return; }
            AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
            if (status == AVAuthorizationStatusAuthorized) { startPython(); return; }
            if (status == AVAuthorizationStatusNotDetermined) {
                writeJSON(job[@"status"], @{@"stage": @"permission"});
                [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
                    dispatch_async(dispatch_get_main_queue(), ^{
                        if (granted) startPython();
                        else finish(@{@"ok": @NO, @"code": @"microphone_denied", @"error": @"Allow Iris Voice in System Settings > Privacy & Security > Microphone, then try again."});
                    });
                }];
            } else finish(@{@"ok": @NO, @"code": @"microphone_denied", @"error": @"Allow Iris Voice in System Settings > Privacy & Security > Microphone, then try again."});
        });
        [NSApp run];
    }
    return 0;
}
