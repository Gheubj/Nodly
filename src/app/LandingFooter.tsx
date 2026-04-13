import { Typography } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import {
  LEGAL_PRIVACY_POLICY_PDF,
  LEGAL_USER_AGREEMENT_PDF,
  NODLY_CONTACT_EMAIL
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
                href={LEGAL_PRIVACY_POLICY_PDF}
                className="landing-footer__a"
                target="_blank"
                rel="noopener noreferrer"
              >
                Политика конфиденциальности
              </a>
              <a
                href={LEGAL_USER_AGREEMENT_PDF}
                className="landing-footer__a"
                target="_blank"
                rel="noopener noreferrer"
              >
                Пользовательское соглашение
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
              href={LEGAL_PRIVACY_POLICY_PDF}
              className="landing-footer__a landing-footer__a--inline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Конфиденциальность
            </a>
            {" · "}
            <a
              href={LEGAL_USER_AGREEMENT_PDF}
              className="landing-footer__a landing-footer__a--inline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Соглашение
            </a>
          </Text>
        </div>
      </div>
    </footer>
  );
}
