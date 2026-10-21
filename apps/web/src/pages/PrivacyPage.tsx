import { useEffect } from 'react'
import { Wordmark } from '../components/brand/Comma'

/** 개인정보처리방침과 사용 기록 수집 고지 */
export default function PrivacyPage() {
  useEffect(() => {
    document.title = '개인정보처리방침 | 이만,'
  }, [])
  return (
    <div className="grid min-h-full items-start justify-items-center px-4 pt-[calc(32px+env(safe-area-inset-top))] pb-8">
      <article className="grid gap-4 w-full max-w-[680px] [&_h2]:text-[26px] [&_h3]:mb-1.5 [&_h3]:text-lg [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
        <Wordmark size={36} />
        <h2>개인정보처리방침</h2>
        <section>
          <h3>수집하는 정보</h3>
          <ul>
            <li>구글 계정의 이름, 이메일, 프로필 사진(로그인 확인용)</li>
            <li>안드로이드 사용 기록 중 앱 패키지 이름, 앱 이름과 카테고리, 화면에 띄운 시작 시각과 종료 시각</li>
            <li>기기 이름, 안드로이드 버전, 앱 버전, 알림 전송용 토큰</li>
          </ul>
          <p>메시지 내용, 화면 내용, 위치, 연락처, 입력한 글자는 수집하지 않아요.</p>
        </section>
        <section>
          <h3>이용 목적</h3>
          <p>총 사용시간과 실제 사용시간 계산, 목표 판정과 넛지 알림, 그룹 현황과 대시보드 표시, 주간 리포트에만 사용해요.</p>
        </section>
        <section>
          <h3>그룹 공유 범위</h3>
          <p>
            그룹 구성원과 대시보드에는 그룹대표가 정한 공개 수준(요약만, 카테고리까지, 앱까지)만큼만 보여요. 앱별 시작과 종료 시각 같은 원본 기록은 본인만 볼 수 있어요.
            적용된 공개 수준은 초대 수락 화면과 설정 화면에서 언제든 확인할 수 있어요.
          </p>
        </section>
        <section>
          <h3>보관과 삭제</h3>
          <p>기록은 서비스 운영 서버에 보관되고, 기기에는 최근 30일 기록만 남아요. 그룹에서 나가면 그룹에는 더 이상 보이지 않으며, 계정 삭제를 요청하면 모든 기록을 지워요.</p>
        </section>
        <section>
          <h3>문의</h3>
          <p>서비스 운영자에게 연락해 주세요.</p>
        </section>
      </article>
    </div>
  )
}
