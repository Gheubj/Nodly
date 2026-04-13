import { Typography } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import {
  LEGAL_PRIVACY_POLICY_FILE,
  LEGAL_USER_AGREEMENT_FILE,
  NODLY_CONTACT_EMAIL,
  downloadLegalPdf,
  legalPdfFetchUrl
} from "@/shared/legal";

const { Text } = Typography;

const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || NODLY_CONTACT_EMAIL;

function openAuthModal() {
  window.dispatchEvent(new Event("nodly-open-auth"));
}

export function LandingFooter() {
  const { user } = useSessionStore();
  const year = new Date().getFullYear();

  return (
    <footer className="landing-footer" aria-label="Подвал сайта">
      <div className="landing-footer__inner">
        <div className="landing-footer__cols">
          <div className="landing-footer__col">
            <Text strong className="landing-footer__col-title">
              Разделы
            </Text>
            <nav className="landing-footer__links">
              <Link to="/">Главная</Link>
              {user ? <Link to="/studio">Разработка</Link> : null}
              {user ? <Link to="/account">Личный кабинет</Link> : null}
              {user?.role === "teacher" ? <Link to="/teacher">Кабинет учителя</Link> : null}
              {user?.role === "student" && user.studentMode === "school" ? (
                <Link to="/class">Обучение</Link>
              ) : null}
              {user?.role === "student" && user.studentMode === "direct" ? (
                <Link to="/learning">Обучение</Link>
              ) : null}
              {!user ? (
                <button type="button" className="landing-footer__link-btn" onClick={openAuthModal}>
                  Войти
                </button>
              ) : null}
            </nav>
          </div>
          {!user ? (
            <div className="landing-footer__col">
              <Text strong className="landing-footer__col-title">
                О платформе
              </Text>
              <div className="landing-footer__links">
                <a href="#features" className="landing-footer__a">
                  Возможности
                </a>
              </div>
            </div>
          ) : null}
          <div className="landing-footer__col">
            <Text strong className="landing-footer__col-title">
              Документы
            </Text>
            <nav className="landing-footer__links">
              <a
                href={legalPdfFetchUrl(LEGAL_PRIVACY_POLICY_FILE)}
                className="landing-footer__a"
                onClick={(e) => {
                  e.preventDefault();
                  void downloadLegalPdf(LEGAL_PRIVACY_POLICY_FILE);
                }}
              >
                Политика конфиденциальности (PDF)
              </a>
              <a
                href={legalPdfFetchUrl(LEGAL_USER_AGREEMENT_FILE)}
                className="landing-footer__a"
                onClick={(e) => {
                  e.preventDefault();
                  void downloadLegalPdf(LEGAL_USER_AGREEMENT_FILE);
                }}
              >
                Пользовательское соглашение (PDF)
              </a>
            </nav>
          </div>
          <div className="landing-footer__col">
            <Text strong className="landing-footer__col-title">
              Контакты
            </Text>
            <div className="landing-footer__contact">
              <a href={`mailto:${CONTACT_EMAIL}`} className="landing-footer__a">
                {CONTACT_EMAIL}
              </a>
              <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                Вопросы и предложения по платформе
              </Text>
            </div>
          </div>
        </div>
        <div className="landing-footer__bottom">
          <Text type="secondary" style={{ fontSize: 12 }}>
            © {year} Nodly · ИИ и машинное обучение в браузере ·{" "}
            <a
              href={legalPdfFetchUrl(LEGAL_PRIVACY_POLICY_FILE)}
              className="landing-footer__a landing-footer__bottom-link"
              onClick={(e) => {
                e.preventDefault();
                void downloadLegalPdf(LEGAL_PRIVACY_POLICY_FILE);
              }}
            >
              Конфиденциальность
            </a>
            {" · "}
            <a
              href={legalPdfFetchUrl(LEGAL_USER_AGREEMENT_FILE)}
              className="landing-footer__a landing-footer__bottom-link"
              onClick={(e) => {
                e.preventDefault();
                void downloadLegalPdf(LEGAL_USER_AGREEMENT_FILE);
              }}
            >
              Соглашение
            </a>
          </Text>
        </div>
      </div>
    </footer>
  );
}
