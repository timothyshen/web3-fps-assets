using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine.Networking;

namespace Game.Web3
{
    /// <summary>
    /// 让 UnityWebRequest 支持 async/await，且不引入 UniTask 之类的外部依赖。
    /// 这样这个 SDK 可以直接丢进任何 Unity 工程，不用先谈包管理。
    /// </summary>
    public static class UnityWebRequestAwaiter
    {
        public static Task AwaitAsync(this UnityWebRequestAsyncOperation operation, CancellationToken ct = default)
        {
            if (operation == null) throw new ArgumentNullException(nameof(operation));

            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            if (operation.isDone)
            {
                tcs.TrySetResult(true);
                return tcs.Task;
            }

            CancellationTokenRegistration registration = default;

            void OnCompleted(AsyncOperation _)
            {
                registration.Dispose();
                tcs.TrySetResult(true);
            }

            operation.completed += OnCompleted;

            if (ct.CanBeCanceled)
            {
                registration = ct.Register(() =>
                {
                    operation.completed -= OnCompleted;
                    // Abort 会让 request.result 变成 ConnectionError，
                    // 但我们在这里就抛 OperationCanceledException，调用方不会走到那一步。
                    operation.webRequest?.Abort();
                    tcs.TrySetCanceled(ct);
                });
            }

            return tcs.Task;
        }
    }
}
